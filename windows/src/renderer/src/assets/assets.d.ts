// Images imported from the renderer resolve to their bundled URL (Vite).
declare module '*.png' {
  const url: string
  export default url
}
