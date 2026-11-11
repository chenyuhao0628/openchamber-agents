/**
 * Overlay scrollbar activity tracker matching OpenChamber's guest scrollbar contract.
 * Marks whichever element scrolls with `data-oc-scrolling` and clears it 1s after idle.
 */
export function installScrollbarActivity(doc: Document = document): void {
  const root = doc.documentElement;
  if (root.hasAttribute('data-oc-scrollbar-activity')) return;
  root.setAttribute('data-oc-scrollbar-activity', '');
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  doc.addEventListener(
    'scroll',
    (event) => {
      const target = event.target === doc ? root : event.target;
      if (!(target instanceof Element)) return;
      if (!target.hasAttribute('data-oc-scrolling')) {
        target.setAttribute('data-oc-scrolling', '');
      }
      const pending = timers.get(target);
      if (pending !== undefined) clearTimeout(pending);
      timers.set(
        target,
        setTimeout(() => {
          timers.delete(target);
          target.removeAttribute('data-oc-scrolling');
        }, 1000),
      );
    },
    { capture: true, passive: true },
  );
}
