# Accepts an already opened byte reader. This helper never opens a port or writes.
function Read-Pf700StatusReply($Reader) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  # At most 48 busy indicators plus the largest wrapped response.
  [byte[]]$buffer = New-Object byte[] 149
  $count = 0
  while ($count -lt $buffer.Length -and $clock.ElapsedMilliseconds -lt 2500) {
    $next = $Reader.ReadByte()
    if ($next -lt 0) { throw [System.IO.EndOfStreamException]::new() }
    $buffer[$count] = $next
    $count++
    # ETX and NAK cannot occur inside a valid status-only response.
    if ($next -eq 3 -or $next -eq 21) {
      return ,([byte[]]$buffer[0..($count - 1)])
    }
  }
  throw [TimeoutException]::new('Incomplete status reply.')
}
