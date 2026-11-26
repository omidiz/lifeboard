export interface View {
  el: HTMLElement;
  /** Called before the view is replaced: flush pending saves, remove listeners. */
  destroy?(): void;
}
