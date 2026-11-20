"""Build the side-by-side restaurant Cash B update from the original RC2 ZIP."""

import argparse
import copy
import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
APP = "program/resources/app/"
RC2_SHA256 = "a364c984c39624fdbc718ef085d62ec6d5ce3ba47410f55ecf03beb8529302be"
STORY_BASE = "1e8ea282422af68625801b4f991473d86915897a"
RC2_RENDERER_REV = "a4d0b559e2e9fe7856f2954a076d49a81c607080"
DESKTOP_FILES = ("main.js", "payments.js", "test-printing.js", "windows-test-printer.js")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def replace_once(data, old, new):
    if data.count(old) != 1:
        raise ValueError("Unexpected restaurant checkout source near " + old.decode())
    return data.replace(old, new)


def desktop_source(name, original, stage):
    source = "src/desktop/" + name
    base = git("show", STORY_BASE + ":" + source)
    updated = (ROOT / source).read_bytes().replace(b"\r\n", b"\n")
    release = original.replace(b"\r\n", b"\n")
    if name == "main.js":
        # RC2 does not have the separate story branch's journalRecovery argument.
        updated = replace_once(updated, b"fiscalCheckout, null, cashBBarPrinter)",
                               b"fiscalCheckout, cashBBarPrinter)")
    if name == "payments.js":
        base = replace_once(base, b"fiscalCheckout = null, journalRecovery = null) {",
                            b"fiscalCheckout = null) {")
        updated = replace_once(updated, b", journalRecovery = null, cashBBarPrinter",
                               b", cashBBarPrinter")
        # Apply only this story's changes, preserving RC2's supervised card flows.
        inputs = [stage / key for key in ("restaurant.js", "base.js", "updated.js")]
        for path, contents in zip(inputs, (release, base, updated)):
            path.write_bytes(contents)
        updated = git("merge-file", "-p", *map(str, inputs))
    elif release != base:
        raise ValueError("Unexpected restaurant version of " + source)
    return updated.replace(b"\n", b"\r\n")


def build_renderer(stage):
    subprocess.run(["node", "-e", """
        require('esbuild').buildSync({
          absWorkingDir: process.argv[1], entryPoints: ['src/renderer-entry.js'],
          bundle: true, format: 'iife', outfile: 'renderer.js', charset: 'utf8'
        });
    """, str(stage)], cwd=ROOT, check=True)
    return (stage / "renderer.js").read_bytes()


def restaurant_renderer(original, stage):
    # Rebuild the release sources because the packed UI includes RC2-only checkout.
    with zipfile.ZipFile(io.BytesIO(git("archive", "--format=zip", RC2_RENDERER_REV, "src"))) as src:
        src.extractall(stage)
    if build_renderer(stage) != original:
        raise ValueError("The pinned build tools did not reproduce the original RC2 renderer.")
    panel = "src/printing/QueueJobs.js"
    if (stage / panel).read_bytes().replace(b"\r\n", b"\n") != git("show", STORY_BASE + ":" + panel):
        raise ValueError("QueueJobs differs between the story base and RC2.")
    shutil.copyfile(ROOT / panel, stage / panel)
    return build_renderer(stage)


def build(input_zip, output_zip):
    if output_zip.suffix.lower() != ".zip":
        raise ValueError("Choose a new output ZIP.")
    with input_zip.open("rb") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != RC2_SHA256:
            raise ValueError("Expected the original 1.0.10 Cash-Card-Reader-RC2 ZIP.")
    with zipfile.ZipFile(input_zip) as original, tempfile.TemporaryDirectory() as temp:
        stage = Path(temp)
        updates = {}
        for name in DESKTOP_FILES:
            member = APP + "src/desktop/" + name
            updates[member] = desktop_source(name, original.read(member), stage)
        renderer = APP + "dist/renderer-entry.js"
        updates[renderer] = restaurant_renderer(original.read(renderer), stage)
        note = (ROOT / "scripts/cash-b-bar/START-HERE.txt").read_bytes().replace(b"\r\n", b"\n")
        updates["START-HERE.txt"] = note.rstrip() + b"\n\n" + original.read("START-HERE.txt")

        # Exclusive creation preserves older releases, including a named output.
        output = output_zip.open("xb")
        try:
            with output, zipfile.ZipFile(output, "w") as new:
                new.comment = original.comment
                for info in original.infolist():
                    member = copy.copy(info)
                    if info.filename in updates:
                        new.writestr(member, updates[info.filename])
                    else:
                        with original.open(info) as src, new.open(member, "w") as dst:
                            shutil.copyfileobj(src, dst, length=1024 * 1024)
        except BaseException:
            output_zip.unlink()
            raise
    with output_zip.open("rb") as file:
        print(hashlib.file_digest(file, "sha256").hexdigest(), output_zip)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rc2_zip", type=Path)
    parser.add_argument("output_zip", type=Path)
    args = parser.parse_args()
    build(args.rc2_zip, args.output_zip)
