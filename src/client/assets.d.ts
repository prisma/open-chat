// Bun's bundler resolves image imports to served-asset URLs (file loader);
// this tells TypeScript the same story.
declare module "*.webp" {
  const url: string;
  export default url;
}
declare module "*.png" {
  const url: string;
  export default url;
}
