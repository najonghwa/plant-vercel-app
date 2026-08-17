/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 켜져 있는 동안 실제 타입 에러가 배포까지 그대로 통과했다. 지금은 전체가 통과하므로 다시 검사한다.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
