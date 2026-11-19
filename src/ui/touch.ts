// schermi touch (telefono, iPad): i suggerimenti parlano di tocchi, non di tastiera e rotella
export const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(hover: none) and (pointer: coarse)').matches;
