"use client";

import { useEffect, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { Menu } from "../landing/_components/_custom/Menu";
import { Footer } from "../landing/_components/_custom/Footer";

const API = "https://backend.ecli.app/api/public/aegis/attacks";
const REFRESH_MS = 30000;
// Release: 2026-08-20 00:00 local time.
const RELEASE = new Date(2026, 7, 20);

const VECTORS = [
  "SYN flood",
  "UDP flood",
  "ICMP flood",
  "TCP connection exhaustion",
  "HTTP flood",
  "Bandwidth saturation",
  "DNS amplification",
  "NTP amplification",
  "CLDAP amplification",
  "SSDP amplification",
  "Chargen amplification",
  "QOTD amplification",
  "SNMP amplification",
  "Memcached amplification",
  "MSSQL amplification",
  "WS-Discovery amplification",
  "CoAP amplification",
  "IPsec NAT-T amplification",
  "Egress floods (compromised host)",
];

const FEATURES = [
  {
    tag: "THE SHORT VERSION",
    title: "Stops traffic at the front door",
    text: "Most protections filter traffic after it has already slowed your server down. Ours works at the network card, the very first stop, so junk never reaches your game.",
  },
  {
    tag: "REAL CHECKS",
    title: "Bots can't sneak in",
    text: "Connections are checked properly. A bot that skips the real handshake gets turned away, while your real players pass through untouched.",
  },
  {
    tag: "SETS ITSELF UP",
    title: "Learn once, protect forever",
    text: "It watches your traffic and figures out your services on its own. Move a port or add a new server, it keeps up without you.",
  },
  {
    tag: "NO LOCKOUTS",
    title: "Your own traffic always passes",
    text: "If your server is already talking to someone, that someone is trusted. Real players and real connections are never the collateral.",
  },
  {
    tag: "FAIR TO PLAYERS",
    title: "Real players stay fast",
    text: "Players who join the normal way are trusted and stay fast. Attackers can't fake their way into the same treatment.",
  },
  {
    tag: "EVERYONE WELCOME",
    title: "IPv4, IPv6, all of it",
    text: "Minecraft Java and Bedrock, web, SSH, anything that uses a port. Both families of the internet, fully covered.",
  },
];

interface Attack {
  type: string;
  method: string;
  startTs: number;
  endTs: number | null;
  durationSec: number;
  peakDropPps: number;
  peakDropBps: number;
}

interface Totals {
  attacks: number;
  active: number;
  peakDropPps: number;
  peakDropBps: number;
}

interface Live {
  passed: number;
  dropped: number;
  dropRps: number;
  rps: number;
  bps: number;
  learnedPorts: number;
  verified: number;
  banned: number;
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

function fmtPps(n: number) {
  if (!n) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " Gpps";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + " Mpps";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " kpps";
  return Math.round(n) + " pps";
}

function fmtCount(n: number) {
  if (!n) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return Math.round(n).toString();
}

function fmtBps(n: number) {
  if (!n) return "0";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + " Tbps";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " Gbps";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " Mbps";
  return Math.round(n) + " bps";
}

function fmtDur(sec: number) {
  if (!sec || sec < 1) return "<1s";
  if (sec < 60) return sec + "s";
  if (sec < 3600) return Math.floor(sec / 60) + "m " + (sec % 60) + "s";
  return Math.floor(sec / 3600) + "h " + Math.floor((sec % 3600) / 60) + "m";
}

function timeAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

export function AegisClient() {
  const t = useTranslations("aegisPage");
  const [data, setData] = useState<{
    attacks: Attack[];
    totals: Totals;
    live: Live;
  } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const res = await fetch(API, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!mounted) return;
        setData(json);
      } catch {
        // keep showing the last good snapshot
      }
    }
    refresh();
    const iv = setInterval(refresh, REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const diff = RELEASE.getTime() - now;
  const released = diff <= 0;
  const s = Math.max(0, Math.floor(diff / 1000));
  const cd = [
    { label: t("days"), v: Math.floor(s / 86400) },
    { label: t("hours"), v: Math.floor((s % 86400) / 3600) },
    { label: t("minutes"), v: Math.floor((s % 3600) / 60) },
    { label: t("seconds"), v: s % 60 },
  ];

  const totals = data?.totals;
  const live = data?.live;
  const attacks = data?.attacks ?? [];

  return (
    <motion.main
      className="min-h-screen bg-[#0a0a0f] text-white font-flink"
      initial="hidden"
      animate="visible"
      variants={fadeUp}
    >
      <Menu
        customMenu={[
          { href: "#log", label: "Attack log" },
          { href: "#vectors", label: "Vectors" },
          { href: "#features", label: "How it works" },
        ]}
      />

      {/* ── hero ─────────────────────────────────────── */}
      <section className="pt-36 sm:pt-44 pb-16 px-4 sm:px-8 lg:px-16 xl:px-32 2xl:px-60 text-center">
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-4">
          <motion.h1
            className="font-heading font-bold text-5xl sm:text-6xl lg:text-7xl leading-tight"
            variants={fadeUp}
          >
            No DDoS gets <span className="text-white/50">through</span>
          </motion.h1>

          <motion.p
            className="text-white/70 text-lg sm:text-[22px] max-w-2xl mx-auto"
            variants={fadeUp}
          >
            {t("subtitle")}
          </motion.p>

          {!released && (
            <motion.div className="flex flex-col items-center gap-2 mt-4" variants={fadeUp}>
              <span className="text-white/40 text-sm">{t("launchLabel")}</span>
              <div className="flex gap-3">
                {cd.map((c) => (
                  <div key={c.label} className="min-w-20 bg-white/[0.03] border border-white/10 rounded-none px-4 py-3">
                    <div className="font-mono text-3xl leading-none">{String(c.v).padStart(2, "0")}</div>
                    <div className="text-white/40 text-xs uppercase tracking-widest mt-1.5">{c.label}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          <motion.div className="flex gap-4 mt-6 flex-wrap justify-center" variants={fadeUp}>
            <a
              href="https://ecli.app"
              className="bg-white text-black font-semibold rounded-none px-8 py-3 hover:bg-white/80 transition-colors"
            >
              {t("getProtected")}
            </a>
            <a
              href="#log"
              className="border border-white/20 text-white rounded-none px-8 py-3 hover:bg-white/10 transition-colors"
            >
              {t("seeProof")}
            </a>
          </motion.div>
        </motion.div>
      </section>

      <div className="px-4 sm:px-8 lg:px-16 xl:px-32 2xl:px-60 flex flex-col gap-16 sm:gap-20 pb-24">

        {/* ── stats ────────────────────────────────────── */}
        <motion.section
          className="flex flex-col gap-5"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.h2 className="font-heading font-bold text-3xl sm:text-4xl" variants={fadeUp}>
            {t("proofTitle")}
          </motion.h2>
          <motion.p className="text-white/70" variants={fadeUp}>
            {t("proofSub")}
          </motion.p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: t("attacksBlocked"), v: String(totals?.attacks ?? 0) },
              { label: t("activeNow"), v: String(totals?.active ?? 0) },
              { label: t("packetsDropped"), v: fmtCount(live?.dropped ?? 0) },
              { label: t("packetsPassed"), v: fmtCount(live?.passed ?? 0) },
            ].map((st) => (
              <motion.div
                key={st.label}
                className="bg-white/[0.03] border border-white/10 rounded-none p-5"
                variants={fadeUp}
              >
                <div className="text-white/40 text-xs uppercase tracking-widest">{st.label}</div>
                <div className="font-mono text-2xl mt-1">{st.v}</div>
              </motion.div>
            ))}
          </div>
          <motion.p className="text-white/40 font-mono text-sm" variants={fadeUp}>
            {t("rightNow")}: {fmtPps(live?.dropRps ?? 0)} · {t("learnedServices")}:{" "}
            {live?.learnedPorts ?? 0} · {t("trustedIps")}: {live?.verified ?? 0} ·{" "}
            {t("bannedIps")}: {live?.banned ?? 0}
          </motion.p>
        </motion.section>

        {/* ── attack log ───────────────────────────────── */}
        <motion.section
          id="log"
          className="flex flex-col gap-5"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.h2 className="font-heading font-bold text-3xl sm:text-4xl" variants={fadeUp}>
            {t("logTitle")}
          </motion.h2>
          <motion.p className="text-white/70" variants={fadeUp}>
            {t("logSub")}
          </motion.p>
          <motion.div className="border border-white/10 rounded-none overflow-x-auto" variants={fadeUp}>
            <table className="w-full text-left text-sm font-sans">
              <thead>
                <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
                  <th className="px-5 py-3.5 font-medium">{t("colVector")}</th>
                  <th className="px-5 py-3.5 font-medium">{t("colStarted")}</th>
                  <th className="px-5 py-3.5 font-medium">{t("colDuration")}</th>
                  <th className="px-5 py-3.5 font-medium">{t("colPeakDrop")}</th>
                  <th className="px-5 py-3.5 font-medium">{t("colPeakBandwidth")}</th>
                  <th className="px-5 py-3.5 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {!data ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-white/40">
                      {t("loading")}
                    </td>
                  </tr>
                ) : attacks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-white/40">
                      {t("empty")}
                    </td>
                  </tr>
                ) : (
                  attacks.slice(0, 25).map((a, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="px-5 py-3.5">{a.method || a.type || "Unknown"}</td>
                      <td className="px-5 py-3.5 text-white/60">{timeAgo(Number(a.startTs) || 0)}</td>
                      <td className="px-5 py-3.5 text-white/60">{fmtDur(Number(a.durationSec) || 0)}</td>
                      <td className="px-5 py-3.5 font-mono">{fmtPps(Number(a.peakDropPps) || 0)}</td>
                      <td className="px-5 py-3.5 font-mono">{fmtBps(Number(a.peakDropBps) || 0)}</td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`text-xs font-semibold rounded-none px-2.5 py-1 border ${
                            a.endTs == null
                              ? "text-red-300 border-red-400/40 bg-red-400/10"
                              : "text-emerald-300 border-emerald-400/40 bg-emerald-400/10"
                          }`}
                        >
                          {a.endTs == null ? t("liveChip") : t("blockedChip")}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </motion.div>
        </motion.section>

        {/* ── story ────────────────────────────────────── */}
        <motion.section
          className="flex flex-col gap-5"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.h2 className="font-heading font-bold text-3xl sm:text-4xl" variants={fadeUp}>
            {t("storyTitle")}
          </motion.h2>
          <motion.div className="border border-white/10 rounded-none p-6 sm:p-8 flex flex-col gap-4" variants={fadeUp}>
            <p className="text-white/70 text-lg leading-relaxed">{t("story1")}</p>
            <p className="text-white/70 text-lg leading-relaxed">{t("story2")}</p>
          </motion.div>
        </motion.section>

        {/* ── vectors ──────────────────────────────────── */}
        <motion.section
          id="vectors"
          className="flex flex-col gap-5"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.h2 className="font-heading font-bold text-3xl sm:text-4xl" variants={fadeUp}>
            {t("vectorsTitle")}
          </motion.h2>
          <motion.p className="text-white/70" variants={fadeUp}>
            {t("vectorsSub")}
          </motion.p>
          <motion.div className="flex flex-wrap gap-2" variants={fadeUp}>
            {VECTORS.map((v) => (
              <span
                key={v}
                className="text-sm text-white/60 border border-white/10 bg-white/5 rounded-none px-3.5 py-1.5"
              >
                {v}
              </span>
            ))}
          </motion.div>
        </motion.section>

        {/* ── features ─────────────────────────────────── */}
        <motion.section
          id="features"
          className="flex flex-col gap-5"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.h2 className="font-heading font-bold text-3xl sm:text-4xl" variants={fadeUp}>
            {t("featuresTitle")}
          </motion.h2>
          <motion.p className="text-white/70" variants={fadeUp}>
            {t("featuresSub")}
          </motion.p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <motion.div
                key={f.title}
                className="bg-white/[0.03] border border-white/10 rounded-none p-6 flex flex-col gap-2"
                variants={fadeUp}
              >
                <span className="font-mono text-xs text-white/40 tracking-widest">{f.tag}</span>
                <h3 className="font-heading font-bold text-xl">{f.title}</h3>
                <p className="text-white/70">{f.text}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>
      </div>

      <Footer />
    </motion.main>
  );
}
