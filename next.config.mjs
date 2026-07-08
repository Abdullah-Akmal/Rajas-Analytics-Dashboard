/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    // Tree-shake heavy barrel imports so each page ships only the icons/charts it
    // actually uses. Big win for both client bundle size and dev compile time.
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
}

export default nextConfig
