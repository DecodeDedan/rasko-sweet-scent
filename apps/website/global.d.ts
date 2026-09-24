declare module '*.svg' {
  const image: {
    readonly src: string
    readonly height: number
    readonly width: number
  }

  export default image
}
