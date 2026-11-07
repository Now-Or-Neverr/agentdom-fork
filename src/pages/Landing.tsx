import { useRef } from 'react';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';
import { useReveal } from '../lib/useReveal';
import { Hero } from '../landing/Hero';
import { Zoom } from '../landing/Zoom';
import { Guilds } from '../landing/Guilds';
import { AtWork } from '../landing/AtWork';
import { SpeakDecree } from '../landing/SpeakDecree';
import { Court } from '../landing/Court';
import { HowWhy } from '../landing/HowWhy';
import { Gates } from '../landing/Gates';
import '../landing/landing.css';

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <div ref={root} className="ld light">
      <SiteHeader />
      <main>
        <Hero />
        <Zoom />
        <Guilds />
        <AtWork />
        <SpeakDecree />
        <Court />
        <HowWhy />
        <Gates />
      </main>
      <SiteFooter />
    </div>
  );
}
