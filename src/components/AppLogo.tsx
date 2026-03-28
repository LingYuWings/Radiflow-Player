import React from 'react';
import logoSrc from '../../logo.svg';
import { cn } from '../lib/utils';

interface AppLogoProps {
  className?: string;
  imageClassName?: string;
  alt?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({
  className,
  imageClassName,
  alt = 'RadiFlow Player logo',
}) => (
  <div className={cn('overflow-hidden rounded-[22px] shrink-0', className)}>
    <img src={logoSrc} alt={alt} className={cn('h-full w-full object-contain', imageClassName)} draggable={false} />
  </div>
);