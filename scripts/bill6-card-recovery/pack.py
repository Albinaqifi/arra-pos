"""Build the private incident tool from the verified RC5 archive and an operator-specific binding.

The private JSON, binary runtime and output ZIP belong outside version control.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED

HERE = Path(__file__).resolve().parent
ARCHIVE_HASH = 'cb7aedd3c51c2085df68e5a7203cffe4f758255925e938fe991647ad3c52686b'
RUNTIME = {'node.exe': 'd14ba95cdce1ef7dc9ad3ac74949ca5db38b27378ee30f30a23cf26f9e875a11',
           'NODE-LICENSE.txt': '537308465103a306d0e3eecf42632b4ff1b48aaaec044e9fc10a78c81fd00b34'}
DESKTOP = 'src/desktop/'
KIT = 'scripts/bill6-card-recovery/'
def sha(path):
    with path.open('rb') as reader:
        return hashlib.file_digest(reader,'sha256').hexdigest()

def package(rc5, runtime, binding, output, review_only):
    if sha(rc5) != ARCHIVE_HASH or any(sha(runtime / name) != expected for name, expected in RUNTIME.items()):
        raise ValueError('Verify the original RC5 archive and Windows offline runtime.')
    private = json.loads(binding.read_text('utf-8-sig'))
    if not (len(private['lines']) == len(private['itemHex']) == 2 and private['total'] ==
            sum(row['unitPrice']*row['quantity'] for row in private['lines'])):
        raise ValueError('Incomplete private binding.')
    if 'priorJournalHash' in private:
        pin = private['priorJournalHash']
        if not isinstance(pin, str) or len(pin) != 64 or any(c not in '0123456789abcdef' for c in pin):
            raise ValueError('Invalid earlier journal binding.')
    if output.exists():
        raise FileExistsError('Choose a new unused output path.')
    output.parent.mkdir(parents=True,exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as temp:
        candidate = Path(temp) / 'candidate.zip'
        with ZipFile(rc5) as original, ZipFile(candidate,'x',compression=ZIP_DEFLATED,compresslevel=5) as kit:
            for name in RUNTIME:
                kit.write(runtime / name, 'runtime/'+name)
            for name in ('pf700-frame','pf700-payment-registers','pf700-checkout-protocol','session','permissions','untouched-order'):
                rel = DESKTOP+name+'.js'
                kit.writestr(rel,original.read('program/resources/app/'+rel))
            # Copy only the bounded reply reader. No RC5 command sender is in this helper.
            source = original.read('program/resources/app/'+DESKTOP+'pf700-checkout-exchange.ps1').decode('utf-8-sig')
            read_reply = source[source.index('function Read-Pf700CheckoutReply'):source.index('function Invoke-Pf700CheckoutPort')]
            if 'Port.Write' in read_reply or '.Open(' in read_reply:
                raise ValueError('Unexpected serial reader.')
            kit.writestr(KIT+'reply.ps1',read_reply)
            for name in ('operator.cjs','recover.cjs','original.cjs','earlier-journal.cjs','publish.cjs','journal.cjs','device.cjs','start.ps1'):
                kit.write(HERE/name,KIT+name)
            serial = (HERE/'serial.ps1').read_text('utf-8')
            if review_only:
                begin = serial.index('    if ($Mode -ceq \'Review\') { return $reads }')
                end = serial.index('\n}',begin)
                serial = serial[:begin] + '    return $reads' + serial[end:]
                serial = serial.replace("[ValidateSet('Review','Finish')]","[ValidateSet('Review')]")
                if '49/' in serial or '53/' in serial or '56/' in serial:
                    raise ValueError('Review transport unexpectedly admits fiscal writes.')
            kit.writestr(KIT+'serial.ps1',serial)
            kit.writestr(KIT+'incident.json',json.dumps(private,ensure_ascii=True)+'\n')
            # Enforce the distribution mode at both the CLI and physical transport.
            kit.writestr(KIT+'edition.json',json.dumps({'reviewOnly':review_only}))
            for mode in (('Review',) if review_only else ('Review','Finish')):
                launcher = ('@echo off\r\nsetlocal\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" '
                            '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\bill6-card-recovery\\start.ps1" '+mode+
                            '\r\nset "result=%errorlevel%"\r\npause\r\nexit /b %result%\r\n')
                kit.writestr(mode+'-Receipt.cmd',launcher)
            kit.write(HERE/'READ-ME.txt','READ-ME.txt')
        with ZipFile(candidate) as check:
            if check.testzip() is not None: raise ValueError('Incomplete ZIP.')
        os.rename(candidate,output)
    print(sha(output),output)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--review-only',action='store_true')
    for arg in ('rc5','runtime','binding','output'): p.add_argument(arg,type=Path)
    args=p.parse_args()
    package(args.rc5,args.runtime,args.binding,args.output,args.review_only)
