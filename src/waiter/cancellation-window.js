export const cancellationGuidance = 'After two minutes, Admin must approve this cancellation with their PIN.';
export function isCancellationOpen(sentAt, now = Date.now()) {
  return Number.isSafeInteger(sentAt) && sentAt > 0 && Number.isSafeInteger(now) && sentAt <= now && now - sentAt < 120000;
}
export function useCancellationOpen(sentAt) {
  const [, refresh] = React.useState(0);
  React.useEffect(() => {
    let timer;
    let stopped = false;
    const schedule = () => {
      const now = Date.now();
      if (stopped || !isCancellationOpen(sentAt, now)) return;
      // Recheck regularly so local clock adjustments cannot leave the control
      // enabled until an obsolete wall-clock deadline.
      timer = setTimeout(() => { refresh(value => value + 1); schedule(); }, Math.min(1000, sentAt + 120000 - now));
    };
    schedule();
    return () => { stopped = true; clearTimeout(timer); };
  }, [sentAt]);
  return isCancellationOpen(sentAt);
}
