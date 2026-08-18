import {
  planImageTransform,
  type ImagePolicy,
  type ImageTransformOptions,
} from "./images";

export type ImageProps = ImageTransformOptions & {
  className?: string;
  id?: string;
  policy?: ImagePolicy;
};

// The component is the surface that connects the planner to the build. A
// rendered `Image` emits a self-describing variant path in `src`/`srcSet`.
// The static build scans the rendered document for that path, and the
// runtime optimizer parses it back into a real transform request.
export function Image({ className, id, policy, ...options }: ImageProps) {
  const plan = planImageTransform(options, policy);

  return (
    <img
      alt={plan.alt}
      className={className}
      decoding={plan.decoding}
      fetchPriority={plan.fetchPriority}
      height={plan.height}
      id={id}
      loading={plan.loading}
      sizes={plan.sizes}
      src={plan.src}
      srcSet={plan.srcSet}
      width={plan.width}
    />
  );
}
