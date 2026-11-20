"""Build a candidate RC6 from the exact RC5 restaurant archive, offline."""
import argparse
import copy
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
WORKTREE = HERE.parent
RC5 = 'cb7aedd3c51c2085df68e5a7203cffe4f758255925e938fe991647ad3c52686b'
DESKTOP = 'program/resources/app/src/desktop/'
OVERLAYS = {
    DESKTOP + 'pf700-checkout-protocol.js': WORKTREE / 'src/desktop/pf700-checkout-protocol.js',
    DESKTOP + 'pf700-windows-checkout.js': WORKTREE / 'scripts/fast-pay/rc5-windows-checkout.js',
    DESKTOP + 'fast-pay-device.js': WORKTREE / 'scripts/fast-pay/device.js',
    DESKTOP + 'fast-pay-service.js': WORKTREE / 'scripts/fast-pay/service.js',
}
REFERENCES = ('mscorlib', 'System', 'System.Core', 'System.Drawing', 'System.Windows.Forms',
              'System.Security', 'System.Web.Extensions', 'Microsoft.CSharp')


def digest(stream):
    return hashlib.file_digest(stream, 'sha256').hexdigest()


def manifest(archive, updates):
    lines = []
    for name in sorted(archive.namelist()):
        if name == 'Open-Arra-Pay.cmd' or (name.startswith('program/') and not name.endswith('/')):
            if name in updates:
                sha = hashlib.sha256(updates[name]).hexdigest()
            else:
                with archive.open(name) as member:
                    sha = digest(member)
            lines.append(f'{sha}  {name}\n')
    return ''.join(lines).encode('utf-8')


def launcher(directory, contents):
    dotnet = Path(os.environ['ProgramFiles']) / 'dotnet/dotnet.exe'
    version = subprocess.check_output([dotnet, '--version'], cwd=HERE, text=True).strip()
    compiler = dotnet.parent / 'sdk' / version / 'Roslyn/bincore/csc.dll'
    framework = Path(os.environ['SystemRoot']) / 'Microsoft.NET/Framework64/v4.0.30319'
    resource = directory / 'release.txt'
    resource.write_bytes(contents)
    output = directory / 'Arra POS.exe'
    subprocess.run([str(dotnet), str(compiler), '/nologo', '/noconfig', '/nostdlib+', '/target:winexe',
        '/platform:anycpu', '/deterministic+', '/optimize+', '/debug-', '/warnaserror+', '/define:RC6',
        *[f'/reference:{framework / (name + ".dll")}' for name in REFERENCES],
        '/win32icon:Arra.ico', f'/resource:{resource},ArraPOS.RC6.sha256', f'/out:{output}',
        'ArraPos.cs', 'ReleaseFiles.cs'], cwd=HERE, check=True)
    return output.read_bytes()


def build(source, output):
    if output.exists():
        raise FileExistsError(output)
    with source.open('rb') as inp:
        if digest(inp) != RC5:
            raise ValueError('The input is not the verified RC5 archive.')
        inp.seek(0)
        with zipfile.ZipFile(inp) as archive, tempfile.TemporaryDirectory(dir=HERE) as tmp:
            names = archive.namelist()
            if len(names) != len(set(names)) or set(OVERLAYS) - set(names):
                raise ValueError('Unexpected RC5 members.')
            updates = {name: path.read_bytes() for name, path in OVERLAYS.items()}
            contents = manifest(archive, updates)
            updates['Arra POS.exe'] = launcher(Path(tmp), contents)
            updates['START-HERE.txt'] = (HERE / 'START-HERE.txt').read_bytes()
            with zipfile.ZipFile(output, 'x') as target:
                for info in archive.infolist():
                    if info.filename in updates:
                        target.writestr(copy.copy(info), updates[info.filename])
                    else:
                        with archive.open(info) as entry, target.open(copy.copy(info), 'w') as dest:
                            shutil.copyfileobj(entry, dest, length=1024 * 1024)
            with zipfile.ZipFile(output) as target:
                if target.testzip() or manifest(target, {}) != contents:
                    raise ValueError('RC6 archive or integrity manifest verification failed.')
                if any(target.read(name) != data for name, data in updates.items()):
                    raise ValueError('RC6 changed content failed verification.')
                for name in sorted(set(names) - set(updates)):
                    with archive.open(name) as a:
                        expected = digest(a)
                    with target.open(name) as b:
                        if expected != digest(b):
                            raise ValueError('Unexpected member changed: ' + name)
    with output.open('rb') as stream:
        print('SHA256', digest(stream), output)
    print('Manifest entries:', len(contents.splitlines()))
    print('Replaced:', ', '.join(sorted(updates)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rc5', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    build(args.rc5.resolve(), args.output.resolve())
