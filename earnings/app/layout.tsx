import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Earnings Desk · Richard & Dan',description:'Compare earnings research, rank five ideas, and record a price target and thesis.',icons:{icon:'/earnings-tracker/favicon.svg',shortcut:'/earnings-tracker/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body className="antialiased">{children}</body></html>}
