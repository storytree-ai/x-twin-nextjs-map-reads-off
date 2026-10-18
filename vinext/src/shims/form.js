"use client";
// next/form: a <form> whose GET submissions to a string action navigate
// client-side (router.push of the action URL with the fields as its
// query), as next/link does for links. Function actions (server actions)
// and non-GET submissions go to React and the browser as they are.
import { createElement as h, forwardRef } from "react";
import { useRouter } from "./navigation.js";
import { formGetTarget } from "./form-target.js";

/** The submitter's own formaction / formmethod attributes, when it has them. */
function submitterOverrides(el) {
  if (!el || typeof el.getAttribute !== "function") return null;
  return { formAction: el.getAttribute("formaction"), formMethod: el.getAttribute("formmethod") };
}

const Form = forwardRef(function Form({ action, replace, scroll, prefetch, onSubmit, ...props }, ref) {
  const router = useRouter();
  if (typeof action !== "string") return h("form", { ...props, action, onSubmit, ref });

  const handleSubmit = (event) => {
    if (onSubmit) onSubmit(event);
    if (event.defaultPrevented) return;
    const form = event.currentTarget;
    const submitter = event.nativeEvent && event.nativeEvent.submitter;
    const href = formGetTarget({
      action,
      method: props.method,
      submitter: submitterOverrides(submitter),
      entries: new FormData(form, submitter || undefined),
      base: window.location.href,
    });
    if (href === null) return;
    event.preventDefault();
    const options = { scroll: scroll !== false };
    if (replace) router.replace(href, options);
    else router.push(href, options);
  };
  return h("form", { ...props, action, ref, onSubmit: handleSubmit });
});

export default Form;
