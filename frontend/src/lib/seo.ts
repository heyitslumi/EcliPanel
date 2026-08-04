export interface PageSeo {
  title: string;
  description: string;
  noindex?: boolean;
}

const BRAND = "EclipseSystems";

export const PAGE_SEO: Record<string, PageSeo> = {
  "/": {
    title: `EclipseSystems — Next-Gen Hosting Provider`,
    description:
      "Deploy servers and applications in seconds with EclipseSystems. Distributed hosting built for developers — multi-region, DDoS protection, and zero cold starts.",
  },
  "/login": {
    title: `Sign In — ${BRAND}`,
    description: `Sign in to your ${BRAND} account to manage servers, billing, tickets, and more.`,
  },
  "/register": {
    title: `Create Account — ${BRAND}`,
    description: `Create a free ${BRAND} account and deploy your first server in minutes. No credit card required.`,
  },
  "/forgot-password": {
    title: `Reset Password — ${BRAND}`,
    description: `Forgot your ${BRAND} password? Enter your email and we'll send you a secure reset link.`,
  },
  "/restore-email": {
    title: `Restore Email — ${BRAND}`,
    description: `Restore access to your ${BRAND} account email address.`,
  },
  "/verify-email": {
    title: `Verify Email — ${BRAND}`,
    description: `Verify your email address to activate your ${BRAND} account and start deploying servers.`,
  },
  "/oauth/authorize": {
    title: `Authorize Application — ${BRAND}`,
    description: `Authorize a third-party application to securely access your ${BRAND} account.`,
  },
  "/license": {
    title: `License — ${BRAND}`,
    description: `Software licensing terms for ${BRAND} products and services.`,
  },
  "/organisations/accept": {
    title: `Accept Organisation Invite — ${BRAND}`,
    description: `Review and accept or decline a pending ${BRAND} organisation invitation.`,
  },
  "/elo": {
    title: `ELO Servers — ${BRAND}`,
    description:
      "Deploy your open-source server, climb the ranks, and scale from 256 MB to 24 GB RAM. World's first competitive hosting.",
  },
  "/changelogs": {
    title: `Changelogs — ${BRAND}`,
    description: "Latest changelogs of EcliPanel from its contributors <3",
  },
  "/contributors": {
    title: `Contributors — ${BRAND}`,
    description: "People who helped EclipseSystems to make EcliPanel better!",
  },
  "/docs": {
    title: `Documentation — ${BRAND}`,
    description:
      "Learn how to set up your account, deploy servers, manage resources, and get help with EcliPanel.",
  },
  "/docs/getting-started": {
    title: `Getting Started — ${BRAND}`,
    description:
      "Create an account, verify your email, secure it with 2FA, and deploy your first server in under 10 minutes.",
  },
  "/docs/server-management": {
    title: `Server Management — ${BRAND}`,
    description:
      "Console access, file management, databases, port forwarding, power controls, and troubleshooting guides.",
  },
  "/docs/kvm": {
    title: `KVM & Linux Guide — ${BRAND}`,
    description:
      "Deploy the Debian 13 VM, set up SSH, harden security, configure the firewall, and learn essential Linux commands.",
  },
  "/docs/deploying-apps": {
    title: `Deploying Apps & Games — ${BRAND}`,
    description:
      "Every available template explained, how to choose the right one, and step-by-step deployment workflows.",
  },
  "/docs/sunset": {
    title: `Sunset Policy — ${BRAND}`,
    description:
      "How inactivity notices work, grace periods, what happens to idle accounts and servers, and how to stay active.",
  },
  "/docs/support": {
    title: `Support & Policies — ${BRAND}`,
    description:
      "Open tickets, track responses, and access the full legal center for terms, privacy, and acceptable use.",
  },
  "/docs/eclihalo": {
    title: `EcliHalo — ${BRAND}`,
    description: `EcliHalo documentation — deploy and manage your services on the EcliHalo network.`,
  },
  "/docs/elo": {
    title: `ELO Documentation — ${BRAND}`,
    description:
      "Learn how the ELO ranking system works and how to deploy, rank, and scale your open-source server.",
  },
  "/docs/blog-handbook": {
    title: `Blog Handbook — ${BRAND}`,
    description:
      "Everything you need to know about writing, publishing, and managing posts on your EcliPanel blog.",
  },
  "/legal": {
    title: `Legal — ${BRAND}`,
    description: `Legal information, policies, and compliance documents for ${BRAND}.`,
  },
  "/legal/privacy-policy": {
    title: `Privacy Policy — ${BRAND}`,
    description: `How ${BRAND} collects, uses, stores, and protects your personal data.`,
  },
  "/legal/terms-of-service": {
    title: `Terms of Service — ${BRAND}`,
    description: `The terms and conditions that govern your use of ${BRAND} services.`,
  },
  "/legal/acceptable-use-policy": {
    title: `Acceptable Use Policy — ${BRAND}`,
    description: `Rules for acceptable use of ${BRAND} hosting services and network.`,
  },
  "/legal/ai-policy": {
    title: `AI Policy — ${BRAND}`,
    description: `How ${BRAND} uses artificial intelligence across its platform and services.`,
  },
  "/legal/cookies-policy": {
    title: `Cookies Policy — ${BRAND}`,
    description: `How ${BRAND} uses cookies and similar technologies on its websites.`,
  },
  "/legal/dmca-copyright-policy": {
    title: `DMCA & Copyright Policy — ${BRAND}`,
    description: `How ${BRAND} handles copyright claims and DMCA takedown requests.`,
  },
  "/legal/email-policy": {
    title: `Email Policy — ${BRAND}`,
    description: `How ${BRAND} manages email delivery, retention, and abuse reporting.`,
  },
  "/legal/imprint": {
    title: `Imprint — ${BRAND}`,
    description: `Company information and legal imprint for ${BRAND}.`,
  },
  "/legal/minimum-age": {
    title: `Minimum Age Requirements — ${BRAND}`,
    description: `Registration age requirements for ${BRAND} by country.`,
  },
  "/tunnel/verify": {
    title: `Verify Tunnel Device — ${BRAND}`,
    description: `Verify and authorize your EcliTunnel device to expose local services securely.`,
  },
  "/404": {
    title: `Page Not Found — ${BRAND}`,
    description: `This page doesn't exist, but your next deployment could.`,
  },
};

export const PAGE_SEO_DASHBOARD: Record<string, PageSeo> = {
  "/dashboard": {
    title: `Dashboard — ${BRAND}`,
    description: "Security Operations Center overview, server resources, and recent activity.",
    noindex: true,
  },
  "/dashboard/activity": {
    title: `Activity Log — ${BRAND}`,
    description: `Review your recent account and server activity on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/admin": {
    title: `Admin — ${BRAND}`,
    description: `Admin panel for managing ${BRAND} platform settings, users, and operations.`,
    noindex: true,
  },
  "/dashboard/ai-chat": {
    title: `AI Chat — ${BRAND}`,
    description: `Chat with ${BRAND}'s AI assistant.`,
    noindex: true,
  },
  "/dashboard/ai-studio": {
    title: `AI Studio — ${BRAND}`,
    description: `Manage and interact with AI models in ${BRAND} AI Studio.`,
    noindex: true,
  },
  "/dashboard/applications": {
    title: `Applications — ${BRAND}`,
    description: `Manage your ${BRAND} applications.`,
    noindex: true,
  },
  "/dashboard/billing": {
    title: `Billing — ${BRAND}`,
    description: `Manage subscriptions, invoices, and payment methods on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/blog": {
    title: `Blog — ${BRAND}`,
    description: `Manage your ${BRAND} blog, posts, and members.`,
    noindex: true,
  },
  "/dashboard/blog/analytics": {
    title: `Blog Analytics — ${BRAND}`,
    description: `Track your blog's performance on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/blog/builder": {
    title: `Blog Builder — ${BRAND}`,
    description: `Customize and build your ${BRAND} blog.`,
    noindex: true,
  },
  "/dashboard/blog/members": {
    title: `Blog Members — ${BRAND}`,
    description: `Manage the members and authors of your ${BRAND} blog.`,
    noindex: true,
  },
  "/dashboard/blog/scripts": {
    title: `Blog Scripts — ${BRAND}`,
    description: `Manage scripts for your ${BRAND} blog.`,
    noindex: true,
  },
  "/dashboard/blog/settings": {
    title: `Blog Settings — ${BRAND}`,
    description: `Configure settings for your ${BRAND} blog.`,
    noindex: true,
  },
  "/dashboard/calendar": {
    title: `Calendar — ${BRAND}`,
    description: `View your bookings and schedule on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/chat": {
    title: `Chat — ${BRAND}`,
    description: `Real-time chat in your ${BRAND} panel.`,
    noindex: true,
  },
  "/dashboard/elo": {
    title: `ELO — ${BRAND}`,
    description: `Manage your ELO-ranked server on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/elo/leaderboard": {
    title: `ELO Leaderboard — ${BRAND}`,
    description: `Browse the top-ranked ELO servers on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/elo/vote": {
    title: `ELO Vote — ${BRAND}`,
    description: `Vote for your favorite ELO-ranked servers on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/identity": {
    title: `Identity Verification — ${BRAND}`,
    description: `Complete identity verification for your ${BRAND} account.`,
    noindex: true,
  },
  "/dashboard/infrastructure/nodes": {
    title: `Nodes — ${BRAND}`,
    description: `Manage the nodes connected to your ${BRAND} account and the servers they run.`,
    noindex: true,
  },
  "/dashboard/infrastructure/visual-editor": {
    title: `Visual Editor — ${BRAND}`,
    description: `Build apps and automations visually with blocks, then generate runnable code.`,
    noindex: true,
  },
  "/dashboard/mailbox": {
    title: `Mailbox — ${BRAND}`,
    description: `Read and manage your ${BRAND} email inbox.`,
    noindex: true,
  },
  "/dashboard/nodes": {
    title: `Nodes — ${BRAND}`,
    description: `Manage the nodes connected to your ${BRAND} account.`,
    noindex: true,
  },
  "/dashboard/organisations": {
    title: `Organisations — ${BRAND}`,
    description: `Manage your ${BRAND} organisations and members.`,
    noindex: true,
  },
  "/dashboard/organisations/create": {
    title: `Create Organisation — ${BRAND}`,
    description: `Create a new organisation on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/servers": {
    title: `Servers — ${BRAND}`,
    description: `Manage and monitor your servers on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/settings": {
    title: `Settings — ${BRAND}`,
    description: `Manage your account settings, preferences, and security on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/student-benefits": {
    title: `Student Benefits — ${BRAND}`,
    description: `Claim student benefits and discounts on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/subusers/invites": {
    title: `Subuser Invites — ${BRAND}`,
    description: `Manage subuser invites for your ${BRAND} servers.`,
    noindex: true,
  },
  "/dashboard/tickets": {
    title: `Support Tickets — ${BRAND}`,
    description: `Contact support and track your tickets on ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/tickets/new": {
    title: `New Ticket — ${BRAND}`,
    description: `Open a new support ticket with ${BRAND}.`,
    noindex: true,
  },
  "/dashboard/tunnels": {
    title: `Tunnels — ${BRAND}`,
    description: `Manage your EcliTunnel tunnels on ${BRAND}.`,
    noindex: true,
  },
};

const PREFIX_FALLBACKS: Array<{ prefix: string; seo: PageSeo }> = [
  {
    prefix: "/dashboard",
    seo: {
      title: `Dashboard — ${BRAND}`,
      description: `Manage your servers, billing, tickets, and settings from the ${BRAND} panel.`,
      noindex: true,
    },
  },
  {
    prefix: "/blog",
    seo: {
      title: `Blog — ${BRAND}`,
      description: `Blogs hosted on ${BRAND} are powered by EcliPanel, a next-gen hosting platform for developers.`,
    },
  },
  {
    prefix: "/share",
    seo: {
      title: `Shared File — ${BRAND}`,
      description: `View a file shared on ${BRAND}.`,
    },
  },
  {
    prefix: "/calendar/book",
    seo: {
      title: `Book Server — ${BRAND}`,
      description: `Book and reserve a server slot on ${BRAND}.`,
    },
  },
  {
    prefix: "/reset-password",
    seo: {
      title: `Reset Password — ${BRAND}`,
      description: `Set a new password for your ${BRAND} account.`,
    },
  },
  {
    prefix: "/forms",
    seo: {
      title: `Application Form — ${BRAND}`,
      description: `Submit an application form to ${BRAND}.`,
    },
  },
  {
    prefix: "/contributors",
    seo: {
      title: `Contributor — ${BRAND}`,
      description: `Contributor profile on ${BRAND}.`,
    },
  },
  {
    prefix: "/elo",
    seo: {
      title: `ELO — ${BRAND}`,
      description: "Community-driven server rankings with resource scaling.",
    },
  },
];

export function getPageSeo(pathname: string): PageSeo | null {
  const exact = PAGE_SEO[pathname] || PAGE_SEO_DASHBOARD[pathname];
  if (exact) return exact;
  for (const { prefix, seo } of PREFIX_FALLBACKS) {
    if (pathname.startsWith(prefix)) return seo;
  }
  return null;
}