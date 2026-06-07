import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "J's Smart Farm",
  description: "식물 급수 기록과 ESP32 센서값을 관리하는 대시보드",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
