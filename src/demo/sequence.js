export function demoSequence(start = 100) {
  let next = start;
  return prefix => prefix + next++;
}
