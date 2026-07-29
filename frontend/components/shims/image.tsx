"use client";
// next/image

import React from "react";

interface ImageProps {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
  [key: string]: any;
}

export default function Image({ src, alt = "", width, height, className, style, priority, ...rest }: ImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={style}
      {...rest}
    />
  );
}