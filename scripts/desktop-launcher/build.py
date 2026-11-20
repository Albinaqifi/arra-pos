"""Build the Windows RC4 desktop launcher or the complete RC5 restaurant ZIP."""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile


SOURCE = Path(__file__).resolve().parent
RC4 = "6897302879c29f5231f71692b267d6e2c6c2d6117aa05d0d66c755c3f08d7458"
RC5_MANIFEST = "1b0c296c8b5f8e9a724859a7d8fa7305bf53a7fa786be6bc5d5a441a271282c3"
DESKTOP = "program/resources/app/src/desktop/"
FRAMEWORK = Path(os.environ["SystemRoot"]) / "Microsoft.NET/Framework64/v4.0.30319"
REFERENCES = (
    "mscorlib", "System", "System.Core", "System.Drawing", "System.Windows.Forms",
    "System.Security", "System.Web.Extensions", "Microsoft.CSharp",
)


def release_manifest(archive, updates):
    lines = []
    for name in sorted(archive.namelist()):
        if name == "Open-Arra-Pay.cmd" or (name.startswith("program/") and not name.endswith("/")):
            if name in updates:
                digest = hashlib.sha256(updates[name]).hexdigest()
            else:
                with archive.open(name) as member:
                    digest = hashlib.file_digest(member, "sha256").hexdigest()
            lines.append(f"{digest}  {name}\n")
    return "".join(lines).encode("utf-8")


def pin_updates(archive):
    desktop = SOURCE.parents[1] / "src" / "desktop"
    updates = {}
    for name in ("session.js", "employee-config.js", "sample-accounts.js"):
        # Use the original Windows release line endings independently of Git settings.
        updates[DESKTOP + name] = (desktop / name).read_text("utf-8").replace("\n", "\r\n").encode("utf-8")

    # RC4 setup contains additional commissioning and training checks. Apply only
    # the credential import and waiter provisioning from the updated source.
    setup = "setup-arra-sample.js"
    original = archive.read(DESKTOP + setup)
    source_lines = (desktop / setup).read_text("utf-8").splitlines()
    old_import = b"const { hashPassword, validPassword } = require('./session');"
    anchor = b"  db.prepare('INSERT INTO verified_waiter_pins(user_id) VALUES (?)').run(waiter);"
    import_line, = [line for line in source_lines if line.endswith("= require('./session');")]
    waiter_line, = [line for line in source_lines if "waiterPinCredential(values[4])" in line]
    if original.count(old_import) != 1 or original.count(anchor) != 1:
        raise ValueError("Unrecognized waiter credential setup in RC4.")
    updates[DESKTOP + setup] = original.replace(old_import, import_line.encode()).replace(
        anchor, waiter_line.encode() + b"\r\n" + anchor)
    return updates


def compile_launcher(directory, manifest, edition):
    # Only the build machine needs Roslyn. The GUI uses Windows .NET Framework.
    dotnet = Path(os.environ["ProgramFiles"]) / "dotnet" / "dotnet.exe"
    version = subprocess.check_output([dotnet, "--version"], cwd=SOURCE, text=True).strip()
    compiler = dotnet.parent / "sdk" / version / "Roslyn/bincore/csc.dll"
    resource = directory / "release.txt"
    resource.write_bytes(manifest)
    candidate = directory / "Arra POS.exe"
    subprocess.run([
        dotnet, compiler, "/nologo", "/noconfig", "/nostdlib+", "/target:winexe",
        "/platform:anycpu", "/deterministic+", "/optimize+", "/debug-", "/warnaserror+",
        f"/define:{edition}", *[f"/reference:{FRAMEWORK / (name + '.dll')}" for name in REFERENCES],
        "/win32icon:Arra.ico", f"/resource:{resource},ArraPOS.{edition}.sha256",
        f"/out:{candidate}", "ArraPos.cs", "ReleaseFiles.cs",
    ], cwd=SOURCE, check=True)
    return candidate


def package_rc5(archive, directory):
    updates = pin_updates(archive)
    manifest = release_manifest(archive, updates)
    if hashlib.sha256(manifest).hexdigest() != RC5_MANIFEST:
        raise ValueError("The proposed program does not match the verified RC5 payload.")
    launcher = compile_launcher(directory, manifest, "RC5")
    guide = (SOURCE / "START-HERE-RC5.txt").read_text("utf-8").replace("\n", "\r\n").encode("utf-8")
    updates["START-HERE.txt"] = guide
    candidate = directory / "restaurant.zip"
    with zipfile.ZipFile(candidate, "x") as target:
        for info in archive.infolist():
            if info.filename in updates:
                target.writestr(info, updates[info.filename])
            else:
                with archive.open(info) as source, target.open(info, "w") as dest:
                    shutil.copyfileobj(source, dest, length=1024 * 1024)
        exe = zipfile.ZipInfo(launcher.name, (2026, 11, 20, 0, 0, 0))
        target.writestr(exe, launcher.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(candidate) as target:
        if (release_manifest(target, {}) != manifest or target.read(launcher.name) != launcher.read_bytes()
                or target.read("START-HERE.txt") != guide):
            raise ValueError("The completed ZIP failed RC5 verification.")
    return candidate


def build(archive, output, rc5=False):
    if output.exists():
        raise FileExistsError("Choose a new output file: " + str(output))
    output.parent.mkdir(parents=True, exist_ok=True)
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != RC4:
            raise ValueError("Supply the verified Arra POS Pay and Cash B Bar RC4 ZIP.")
        with zipfile.ZipFile(stream) as original, tempfile.TemporaryDirectory(dir=output.parent) as temp:
            directory = Path(temp)
            if rc5:
                candidate = package_rc5(original, directory)
            else:
                candidate = compile_launcher(directory, release_manifest(original, {}), "RC4")
            candidate.rename(output)
    with output.open("rb") as stream:
        print(hashlib.file_digest(stream, "sha256").hexdigest(), output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rc5", action="store_true", help="build the restaurant ZIP with waiter PINs and desktop launcher")
    parser.add_argument("rc4_zip", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.rc4_zip.resolve(), args.output.resolve(), args.rc5)
