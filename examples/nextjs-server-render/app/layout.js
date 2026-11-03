export const metadata = { title: 'rullino: preview in the browser, render on the server' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, font: '14px system-ui, sans-serif', padding: 16 }}>{children}</body>
    </html>
  );
}
