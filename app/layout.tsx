import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "RDM Desk",
  description: "Weekly Outlook + RDM Clearance — painel de disciplina e condições de mercado NQ/ES",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
