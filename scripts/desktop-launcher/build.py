"""Build the offline Windows desktop launcher for the enrolled RC4 restaurant app."""

import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile


SOURCE = Path(__file__).resolve().parent
RC4 = "6897302879c29f5231f71692b267d6e2c6c2d6117aa05d0d66c755c3f08d7458"
FRAMEWORK = Path(os.environ["SystemRoot"]) / "Microsoft.NET/Framework64/v4.0.30319"
REFERENCES = (
    "mscorlib", "System", "System.Core", "System.Drawing", "System.Windows.Forms",
    "System.Security", "System.Web.Extensions", "Microsoft.CSharp",
)


def release_manifest(source, manifest):
    with source.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != RC4:
            raise ValueError("Supply the verified Arra POS Pay and Cash B Bar RC4 ZIP.")
        with zipfile.ZipFile(stream) as archive:
            lines = []
            for name in sorted(archive.namelist()):
                if name == "Open-Arra-Pay.cmd" or (name.startswith("program/") and not name.endswith("/")):
                    with archive.open(name) as member:
                        digest = hashlib.file_digest(member, "sha256").hexdigest()
                    lines.append(f"{digest}  {name}\n")
    manifest.write_bytes("".join(lines).encode("utf-8"))


def build(archive, output):
    # The build machine supplies Roslyn. The resulting GUI executable runs on
    # Windows .NET Framework and does not need dotnet, Python or a network.
    dotnet = Path(os.environ["ProgramFiles"]) / "dotnet" / "dotnet.exe"
    version = subprocess.check_output([dotnet, "--version"], cwd=SOURCE, text=True).strip()
    compiler = dotnet.parent / "sdk" / version / "Roslyn/bincore/csc.dll"
    if output.exists():
        raise FileExistsError("Choose a new output file: " + str(output))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temp:
        directory = Path(temp)
        manifest = directory / "release.txt"
        candidate = directory / "Arra POS.exe"
        release_manifest(archive, manifest)
        subprocess.run([
            dotnet, compiler, "/nologo", "/noconfig", "/nostdlib+", "/target:winexe",
            "/platform:anycpu", "/deterministic+", "/optimize+", "/debug-", "/warnaserror+",
            *[f"/reference:{FRAMEWORK / (name + '.dll')}" for name in REFERENCES],
            "/win32icon:Arra.ico", f"/resource:{manifest},ArraPOS.RC4.sha256",
            f"/out:{candidate}", "ArraPos.cs", "ReleaseFiles.cs",
        ], cwd=SOURCE, check=True)
        candidate.rename(output)
    with output.open("rb") as stream:
        print(hashlib.file_digest(stream, "sha256").hexdigest(), output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rc4_zip", type=Path)
    parser.add_argument("new_exe", type=Path)
    args = parser.parse_args()
    build(args.rc4_zip.resolve(), args.new_exe.resolve())
