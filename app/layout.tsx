import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ChatPluginBootstrap } from "@/components/chat-plugin-bootstrap";
import { ChatReasoningVisibilityController } from "@/components/chat-reasoning-visibility-controller";
import { CSSImportEnhancer } from "@/components/css-import-enhancer";
import { PWAManifestInjector } from "@/components/pwa-manifest-injector";
import { PWARegistrar } from "@/components/pwa-registrar";
import "../styles/fonts.css";
import "./globals.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "../styles/account.css";
import "../styles/phone-shell.css";
import "../styles/widgets.css";
import "../styles/chat.css";
import "../styles/character.css";
import "../styles/animations.css";
import "../styles/music.css";
import "../styles/mixology.css";
import "../styles/calendar.css";
import "../styles/diary.css";
import "../styles/story.css";
import "../styles/vn.css";
import "../styles/dwelling.css";
import "../styles/checkphone.css";
import "../styles/black-market.css";
import "../styles/game.css";
import "../styles/app-market.css";
import "../styles/reality-bridge.css";
import "../styles/xiaohongshu.css";
import "../styles/world-builder.css";
import "../styles/interview-magazine.css";
import "../styles/cocreate.css";
import "../styles/qa.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "float",
  description: "float",
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <meta name="theme-color" content="#f8f7f2" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" href="/icon-192.png" type="image/png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="float" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <PWAManifestInjector />
        <PWARegistrar />
        <CSSImportEnhancer />
        <ChatPluginBootstrap />
        <ChatReasoningVisibilityController />
        {children}
      </body>
    </html>
  );
}
