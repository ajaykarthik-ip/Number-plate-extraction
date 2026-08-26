/** @type {import('next').NextConfig} */
const nextConfig = {
  // The desktop build serves these files from a local static server inside
  // Electron, so the app is exported as plain HTML/CSS/JS with no Node server.
  output: 'export',
  // Every route becomes <route>/index.html, which keeps the static server's
  // path resolution trivial (no extension guessing).
  trailingSlash: true,
  // next/image optimisation needs a server; there is none in an export.
  images: { unoptimized: true },
}

export default nextConfig
