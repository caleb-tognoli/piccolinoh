/**
 * A list row's action buttons: shown while the row is hovered or focused (or
 * one of its menus is open), always on touch screens, where there's no hover.
 * The row needs the `group` class.
 */
export const ROW_ACTIONS =
  "flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100";
