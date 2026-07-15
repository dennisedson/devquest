import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Install DevQuest",
  description: "Set up the DevQuest onboarding agent in your Notion workspace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f9f9f8", color: "#1a1a1a" }}>
        {children}
      </body>
    </html>
  );
}
