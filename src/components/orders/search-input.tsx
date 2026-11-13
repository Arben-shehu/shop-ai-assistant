"use client";
import { useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useUrlParams } from "./use-url-params";

/** Debounced search box bound to a URL param (default `q`). Shared by /orders and /stock. */
export function SearchInput({ placeholder, param = "q", className }: { placeholder: string; param?: string; className?: string }) {
  const { searchParams, setParams, isPending } = useUrlParams();
  const urlValue = searchParams.get(param) ?? "";
  const [value, setValue] = useState(urlValue);
  const [seenUrlValue, setSeenUrlValue] = useState(urlValue);
  const [pushed, setPushed] = useState(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // URL changed from outside (e.g. "clear filters" link): adopt it, unless it's just our own debounced push.
  if (urlValue !== seenUrlValue) {
    setSeenUrlValue(urlValue);
    if (urlValue !== pushed) setValue(urlValue);
  }

  function onChange(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const q = next.trim();
      setPushed(q);
      setParams({ [param]: q || null });
    }, 300);
  }

  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {isPending && (
        <InputGroupAddon align="inline-end">
          <Spinner aria-label="Duke kërkuar" />
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
