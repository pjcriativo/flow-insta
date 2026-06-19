import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Flow Insta | Agendamento de Redes Sociais",
  description: "Crie agendamentos de redes sociais com IA para todas as plataformas em segundos. Flow Insta faz parte da suíte de ferramentas MESTRES DO MVP.",
  authors: [{ name: "MESTRES DO MVP" }],
  applicationName: "Flow Insta",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.className} h-full antialiased`}
      // style={
      //   {
      //     "--font-sans": geistSans.style.fontFamily,
      //     "--font-mono": geistMono.style.fontFamily,
      //   } as React.CSSProperties
      // }
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <QueryProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="light"
              enableSystem
              disableTransitionOnChange
            >
              <TooltipProvider>
                {children}
              </TooltipProvider>

              <Toaster  richColors/>
            </ThemeProvider>

          </QueryProvider>

        </AuthProvider>
      </body>
    </html>
  );
}
