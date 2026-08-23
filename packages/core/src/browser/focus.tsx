import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ComponentPropsWithRef,
  type ElementType,
  type ForwardedRef,
  type RefCallback,
  type ReactNode,
} from "react";

export type RouteFocusBoundaryElement = Element & {
  focus?: (options?: FocusOptions) => void;
};

export type RouteFocusRegistration = {
  register(element: RouteFocusBoundaryElement): () => void;
  focus(): boolean;
};

export const RouteFocusContext = createContext<RouteFocusRegistration>({
  register: () => () => undefined,
  focus: () => false,
});

export type RouteFocusBoundaryProps<
  TAs extends ElementType = "div",
> = {
  as?: TAs;
} & Omit<ComponentPropsWithRef<TAs>, "as" | "tabIndex">;

export function useRouteFocusBoundary<
  TElement extends RouteFocusBoundaryElement = RouteFocusBoundaryElement,
>() {
  const registration = useContext(RouteFocusContext);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const ref = useCallback<RefCallback<TElement>>((element) => {
    cleanup.current?.();
    cleanup.current = undefined;

    if (element) {
      cleanup.current = registration.register(element);
    }
  }, [registration]);

  return useMemo(() => ({
    ref,
    tabIndex: -1 as const,
  }), [ref]);
}

export function RouteFocusBoundary<
  TAs extends ElementType = "div",
>(props: RouteFocusBoundaryProps<TAs> & { children?: ReactNode }) {
  const { as, children, ref, ...elementProps } = props;
  const boundary = useRouteFocusBoundary();
  const composedRef = useCallback((element: RouteFocusBoundaryElement | null) => {
    if (element) {
      boundary.ref(element);
      assignRef(ref, element);
      return;
    }

    // The application ref must clear before the router removes registration.
    assignRef(ref, null);
    boundary.ref(null);
  }, [boundary.ref, ref]);

  return createElement(as ?? "div", {
    ...elementProps,
    ...boundary,
    ref: composedRef,
    children,
  });
}

function assignRef<T>(ref: ForwardedRef<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}
