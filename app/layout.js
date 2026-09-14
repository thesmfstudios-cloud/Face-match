import './globals.css';

export const metadata = {
  title: 'SMF Photo Match',
  description: 'Find your event photos by face and buy original-quality downloads.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
