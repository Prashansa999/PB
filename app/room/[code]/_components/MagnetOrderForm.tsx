"use client";

import { useState } from "react";
import type { MagnetAddress } from "@/lib/shared/protocol";

const emptyAddress: MagnetAddress = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
};

function AddressFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MagnetAddress;
  onChange: (a: MagnetAddress) => void;
}) {
  function set<K extends keyof MagnetAddress>(key: K, v: string) {
    onChange({ ...value, [key]: v });
  }
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 font-semibold">{label}</legend>
      <input
        required
        placeholder="Full name"
        value={value.name}
        onChange={(e) => set("name", e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <input
        required
        placeholder="Address line 1"
        value={value.line1}
        onChange={(e) => set("line1", e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <input
        placeholder="Address line 2 (optional)"
        value={value.line2}
        onChange={(e) => set("line2", e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          required
          placeholder="City"
          value={value.city}
          onChange={(e) => set("city", e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          required
          placeholder="State / region"
          value={value.region}
          onChange={(e) => set("region", e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          required
          placeholder="Postal code"
          value={value.postalCode}
          onChange={(e) => set("postalCode", e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          required
          placeholder="Country"
          value={value.country}
          onChange={(e) => set("country", e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
    </fieldset>
  );
}

export function MagnetOrderForm({
  onSubmit,
  onClose,
  confirmedOrderId,
}: {
  onSubmit: (addressHost: MagnetAddress, addressGuest: MagnetAddress) => void;
  onClose: () => void;
  confirmedOrderId: string | null;
}) {
  const [addressHost, setAddressHost] = useState<MagnetAddress>(emptyAddress);
  const [addressGuest, setAddressGuest] = useState<MagnetAddress>(emptyAddress);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-2xl">
        {confirmedOrderId ? (
          <div className="text-center">
            <p className="text-4xl">🧲</p>
            <h2 className="mt-3 text-xl font-bold">Magnets on the way!</h2>
            <p className="mt-2 text-sm opacity-75">
              Order <span className="font-mono">#{confirmedOrderId}</span>{" "}
              confirmed. We&rsquo;ll print
              your strip as a die-cut fridge magnet and ship one to each of you.
            </p>
            <p className="mt-3 text-xs opacity-50">
              (Demo checkout — no real payment or print order was placed.)
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-full bg-accent px-6 py-2 font-medium text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Order your magnets</h2>
              <button onClick={onClose} className="text-sm opacity-60 hover:opacity-100">
                Close
              </button>
            </div>
            <p className="mb-4 text-sm opacity-75">
              One payment, two magnets — we ship one to each of you.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitting(true);
                onSubmit(addressHost, addressGuest);
              }}
              className="space-y-5"
            >
              <AddressFields label="Your address" value={addressHost} onChange={setAddressHost} />
              <AddressFields label="Their address" value={addressGuest} onChange={setAddressGuest} />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-accent py-3 font-semibold text-white disabled:opacity-60"
              >
                {submitting ? "Placing order…" : "Place demo order"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
