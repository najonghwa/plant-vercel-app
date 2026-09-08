import type { Metadata } from "next";
import { Cormorant_Garamond, Nanum_Myeongjo } from "next/font/google";
import "./globals.css";

// 라틴 학명·숫자는 Cormorant. 한글은 프리텐다드(아래 <head>의 CDN)이고, 나눔명조는 예비.
// next/font로 넣어 배포 시 자체 호스팅되고, 로드 전후 레이아웃이 흔들리지 않는다.
const latin = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-lat",
  display: "swap",
});

const korean = Nanum_Myeongjo({
  weight: ["400", "700", "800"],
  variable: "--font-kr",
  display: "swap",
  // 이 글꼴은 Google Fonts에 한글 서브셋 이름이 따로 없어 프리로드를 끈다.
  preload: false,
});

export const metadata: Metadata = {
  title: "J's Smart Farm",
  description: "식물 급수 기록과 ESP32 센서값을 관리하는 대시보드",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${latin.variable} ${korean.variable}`}>
      <head>
        {/* 한글 본문은 프리텐다드. Google Fonts에 없어 공식 CDN의 동적 서브셋을 쓴다.
            쓰인 글자 구간만 내려받으므로 가변 통파일(2MB)보다 훨씬 가볍다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
