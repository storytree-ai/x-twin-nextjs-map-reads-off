// next/image: a plain <img> honouring width/height/fill and static imports.
import { createElement, forwardRef } from "react";

const Image = forwardRef(function Image(props, ref) {
  const {
    src,
    alt,
    width,
    height,
    fill,
    priority,
    quality,
    placeholder,
    blurDataURL,
    loader,
    unoptimized,
    loading,
    style,
    onLoadingComplete,
    ...rest
  } = props;
  const source = typeof src === "object" && src !== null ? src : { src };
  const w = width ?? (fill ? undefined : source.width);
  const h = height ?? (fill ? undefined : source.height);
  const finalStyle = fill
    ? { position: "absolute", height: "100%", width: "100%", inset: 0, ...style }
    : style;
  return createElement("img", {
    ...rest,
    ref,
    src: source.src,
    alt,
    width: w,
    height: h,
    loading: priority ? undefined : loading || "lazy",
    decoding: "async",
    style: finalStyle,
  });
});

export default Image;
export function getImageProps(props) {
  return { props };
}
