import type { Metadata } from "next";
import { AegisClient } from "./AegisClient";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = createMetadata({
  title: "EcliAegis | DDoS protection for your game server",
  description:
    "EcliAegis stops DDoS attacks before they reach your server. See the real attacks we have blocked on our own network.",
  path: "/aegis",
});

export default function AegisPage() {
  return <AegisClient />;
}
