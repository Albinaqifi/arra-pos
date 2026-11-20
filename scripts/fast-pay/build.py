"""Build Arra Pay from the exact restaurant RC2 or Cash B Bar RC3 ZIP."""

import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile


SOURCE = Path(__file__).resolve().parent
RC2 = "a364c984c39624fdbc718ef085d62ec6d5ce3ba47410f55ecf03beb8529302be"
RC3 = "05bd033f27c3bf1d360afe650dfdc4d674d7402bb221106f2eb7bebc86e6d0fc"
DESKTOP = "program/resources/app/src/desktop/"
RENDERER = "program/resources/app/dist/renderer-entry.js"
LAUNCHER = "program/start-supervised-pf700.ps1"
FILES = {
    "service.js": DESKTOP + "fast-pay-service.js",
    "device.js": DESKTOP + "fast-pay-device.js",
    "preview.js": DESKTOP + "fast-pay-preview.js",
    "report-guard.js": DESKTOP + "fast-pay-report-guard.js",
    "START-HERE.txt": "START-HERE.txt",
}


def replace_once(data, before, after):
    if data.count(before) != 1:
        raise ValueError(f"Unrecognized RC2 integration point: {before}")
    return data.replace(before, after)


def patches(archive, temp, cash_b_bar):
    def edit(name, replacements):
        data = archive.read(name).decode("utf-8")
        for before, after in replacements:
            data = replace_once(data, before, after)
        return data.encode("utf-8")

    main = DESKTOP + "main.js"
    result = {
        main: edit(main, [
            ("const { registerPayments } = require('./payments');",
             "const { registerFastPayments } = require('./fast-pay-service');"),
            ("let database;", "let database;\nlet fastPayments;"),
            ("fiscalCheckout = selectPf700Checkout(process.argv, directory);",
             "fiscalCheckout = process.argv.includes('--arra-fast-pay')\n"
             "        ? require('./fast-pay-device').selectFastPayCheckout(process.argv, directory)\n"
             "        : selectPf700Checkout(process.argv, directory);"),
            ("  registerPayments(", "  fastPayments = registerFastPayments("),
            ("  registerTransferCorrection(", "  if (fastPayments) require('./fast-pay-report-guard').installFastReportGuard(database);\n  registerTransferCorrection("),
            ("  if (database) database.close();", "  fastPayments?.stop();\n  if (database) database.close();"),
        ]),
        DESKTOP + "bills.js": edit(DESKTOP + "bills.js", [
            ("bill.fiscalMode = adapter.mode;",
             "bill.fiscalMode = adapter.mode;\n  if (adapter.fastPayVersion === 1) {\n"
             "    bill.fastPayVersion = 1;\n"
             "    if (bill.id && db.prepare('SELECT 1 FROM fast_pay_v1_legacy_bills WHERE bill_id=?').get(bill.id)) "
             "bill.fastPayLegacyHeld = true;\n  }"),
        ]),
        DESKTOP + "payments.js": edit(DESKTOP + "payments.js", [
            ("module.exports = { CHANNEL, registerPayments };",
             "module.exports = { CHANNEL, registerPayments, recordPayment };"),
        ]),
        DESKTOP + "fiscal-checkout.js": edit(DESKTOP + "fiscal-checkout.js", [
            ("reserveSale, submitSale, failure };", "reserveSale, submitSale, failure, acceptedOutcome };"),
        ]),
        DESKTOP + "fiscal-daily-report.js": edit(DESKTOP + "fiscal-daily-report.js", [
            ("function coverage(db, dayId, report, adapter) {",
             "function coverage(db, dayId, report, adapter) {\n"
             "  if (require('./fast-pay-report-guard').awaitingReceipt(db,adapter)) return {reason:'unresolved'};"),
        ]),
        DESKTOP + "account-a-bills.js": edit(DESKTOP + "account-a-bills.js", [
            ("if(req.action==='accountABillsPreview') return {ok:true,data:{...data,digest:hash}};",
             "if(req.action==='accountABillsPreview') {\n"
             "      const preview = scope === 'combined' ? require('./fast-pay-preview').attachReceiptStatuses(db,data) : data;\n"
             "      return {ok:true,data:{...preview,digest:hash}};\n    }"),
        ]),
        "program/start-fast-pay.ps1": edit(LAUNCHER, [
            ("$app = Join-Path $PSScriptRoot", "if (!$StartRoutine) { throw 'Use Open-Arra-Pay.cmd.' }\n$app = Join-Path $PSScriptRoot"),
            ("Routine PF700 checkout on COM3. Confirming Cash A in Arra registers real sales.",
             "Arra Pay trial. Pay records Cash A or Card A and frees the table. The printer runs separately. "
             "Starting can send receipts saved earlier but never attempted."),
            ("{1}\" {2}' -f $app, $data, $mode", "{1}\" {2} --arra-fast-pay' -f $app, $data, $mode"),
        ]),
        "Open-Arra-Pay.cmd": edit("Arra-Cash-A.cmd", [
            ("start-supervised-pf700.ps1", "start-fast-pay.ps1"),
        ]),
    }
    original, patched = temp / "rc2.js", temp / "pay.js"
    original.write_bytes(archive.read(RENDERER))
    command = ["node", str(SOURCE / "renderer.cjs"), str(original), str(patched)]
    if cash_b_bar:
        command.append("--cash-b-bar")
    subprocess.run(command, check=True)
    result[RENDERER] = patched.read_bytes()
    result.update({name: (SOURCE / src).read_bytes() for src, name in FILES.items()})
    if cash_b_bar:
        result["START-HERE.txt"] = (SOURCE / "START-HERE-PAY-AND-BAR.txt").read_bytes()
    return result


def build(base, output, unpacked=False, cash_b_bar=False):
    if not base.is_file():
        raise ValueError("Restaurant source ZIP not found")
    with base.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != (RC3 if cash_b_bar else RC2):
            expected = "Cash B Bar RC3" if cash_b_bar else "RC2"
            raise ValueError(f"Use the verified {expected} Windows ZIP")
    if output.exists():
        raise FileExistsError(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as directory:
        temp = Path(directory)
        with zipfile.ZipFile(base) as original:
            changes = patches(original, temp, cash_b_bar)
            omit = {"Arra-Cash-A.cmd", "Arra-Card-A-Trial.cmd", "READ-BEFORE-USE.txt"}
            if cash_b_bar:
                omit.add(LAUNCHER)
            retained = [info for info in original.infolist() if info.filename not in changes
                        and info.filename not in omit and not info.filename.startswith("Recovery/")]
            if unpacked:
                candidate = temp / "unpacked"
                for info in retained:
                    original.extract(info, candidate)
                for name, contents in changes.items():
                    dest = candidate / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(contents)
                candidate.rename(output)
                print(f"Unpacked trial files: {output}")
                return
            candidate = temp / "pay.zip"
            with zipfile.ZipFile(candidate, "w") as target:
                for info in retained:
                    with original.open(info) as source, target.open(info, "w") as dest:
                        shutil.copyfileobj(source, dest, length=1024 * 1024)
                for name, contents in changes.items():
                    entry = zipfile.ZipInfo(name, (2026, 11, 20, 0, 0, 0))
                    target.writestr(entry, contents, compress_type=zipfile.ZIP_DEFLATED)
        with zipfile.ZipFile(candidate) as zipped:
            bad = zipped.testzip()
            if bad:
                raise ValueError(f"Failed ZIP integrity check: {bad}")
        # Windows refuses a rename over an existing destination, including a
        # concurrent build that published after the initial output check.
        candidate.rename(output)
    with output.open("rb") as stream:
        print(f"{hashlib.file_digest(stream, 'sha256').hexdigest()}  {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unpacked", action="store_true", help="write a test folder without creating a ZIP")
    parser.add_argument("--cash-b-bar", action="store_true", help="build combined Pay and Bar output from verified RC3")
    parser.add_argument("restaurant_zip", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.restaurant_zip, args.output, unpacked=args.unpacked, cash_b_bar=args.cash_b_bar)
