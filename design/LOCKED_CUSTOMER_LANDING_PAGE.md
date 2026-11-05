# LOCKED DESIGN — TrillionAI Manager Customer Landing Page

> **APPROVED VISUAL DESIGN — 6 November 2026**  
> Product: **TrillionAI Manager™**, standalone commercial SaaS.  
> Repository: `Anselm04/-TrillionAI-Manager` (private).  
> Reference: the customer-facing neon mountain landing-page artwork approved in the TrillionAI product design conversation.  
> **Design asset status:** this file records the approved reference and requirements. The generated PNG has not yet been committed to the GitHub repository; do not claim otherwise.

## Core identity

**TrillionAI Manager — The Autonomous Business Operating System**

This is the **public marketing and conversion landing page for subscribers**, not the internal TrillionAI Ecosystem Core interface.

Prospects and customers see only capabilities applicable to their own businesses. They must never see TrillionAI's proprietary internal products, revenue, agent infrastructure, financial data, repositories, or privileged workflows.

## Locked visual direction

Preserve the appearance and hierarchy of the approved artwork:

- Dark navy / nearly black premium SaaS theme with electric-blue, violet, cyan and magenta lighting.
- The TrillionAI infinity-mark logo with **TrillionAI Manager™** wordmark.
- Purple-blue luminous mountain horizon behind the hero area, with restrained mountain imagery elsewhere.
- High-density but readable command-centre illustrations, glow-bordered rounded panels, legible sans-serif typography and icon-led feature groups.
- Bright gradient CTAs with matching glow, accompanied by a quieter secondary outlined CTA.
- Matching visual family with TrillionAI Identity and TrillionAI Observability while preserving Manager-specific navigation and purpose.
- Modern responsive desktop, tablet and mobile layouts. Accessible contrast, keyboard and screen-reader use, reduced-motion and clearly indicated focus.
- All dashboard screenshots on public pages are **labelled demonstration data** unless recorded from an authorised real demo tenant.

## Approved landing-page composition

### 1. Top navigation
- Brand: TrillionAI Manager™
- Platform
- Features
- Pricing
- Security
- Resources
- Sign In
- Start Free Trial (only when genuine free-trial entitlements, eligibility and billing terms are implemented)

Sticky nav is optional on desktop; mobile collapses into an accessible menu.

### 2. Hero / primary conversion

**Headline:** Operate Your Business With Autonomous Intelligence

**Value proposition:** TrillionAI Manager helps businesses monitor revenue, coordinate workflows, manage approvals and turn operational data into action from one intelligent command centre.

**Primary CTA:** Start Free Trial, only if genuinely available; otherwise replace with **Get Started** or **Join the Waitlist** depending on actual readiness.

**Secondary CTA:** Book Demo, only when a functional booking path exists; otherwise **See How It Works**.

Hero visual: **customer-specific Manager Command Centre**, showing business metrics, current workflows and AI workforce, with explicitly illustrative figures. It must not display TrillionAI's internal Ecosystem Core or proprietary product topology.

### 3. Four-feature trust/value strip
- Revenue Visibility
- Workflow Automation
- Approval Control
- Customer Operations

### 4. Six-capability feature grid
- Unified Revenue View
- Autonomous Workflows
- Live Business Monitoring
- Approval & Audit Trails
- Customer & Team Coordination
- Actionable Insights

Each feature must describe actual implemented functionality when released. Planned features should be labelled accordingly before launch.

### 5. Product-in-action demonstration

Heading: **See TrillionAI Manager in Action**

Place a second read-only product screenshot illustrating a business operations dashboard with:
- Revenue trends, accurately labelled
- Task and project status
- Agent/workflow activity and approvals
- Customer and subscription management
- Performance insights and recommendations

Public screenshots must use synthetic, non-identifying demonstration data, not TrillionAI's real company metrics or customer records.

### 6. How It Works
1. **Connect:** Bring authorised business tools, data sources and workflows into your own tenant.
2. **Monitor:** See verified revenue, tasks, customer activity and business performance.
3. **Act:** Run approved automations and manage decisions within your own permission boundaries.

### 7. Transparent pricing

Show three differentiated cards:
- Starter
- Growth (featured visually)
- Business

The approved image depicts **From NZD 49/month** for Starter and **From NZD 149/month** for Growth, with **Custom** pricing for Business. **These values are design placeholders, not published or authorised commercial prices.** Do not hard-code them into checkout or advertise as live prices without owner approval, confirmed Stripe price IDs, tax handling and cost modelling.

Each tier must state included functions, quotas, any usage/AI charges, overage limits, billing period, cancellation terms and trial conditions. No invented entitlements or hidden costs.

CTAs must only route to functional, verified registration, checkout, or contact destinations.

### 8. Bottom conversion section
Heading: **Ready to run your business from one intelligent command centre?**

Provide primary and secondary conversion paths that are real and consistent with the currently available product lifecycle.

### 9. Footer
Manager branding, product/features/pricing/security/resources and working links to Privacy Policy, Terms, Contact, Support, and account cancellation/billing information where relevant.

## Commercial customer isolation

- Customer Manager is an independently monetised, multi-tenant service.
- No public API, screenshot, demo tenant, sitemap, telemetry or metadata may expose TrillionAI Ecosystem Core's internal financials or infrastructure topology.
- Every operator/customer request must enforce organisation and resource ownership server-side.
- Privileged admin and integration credentials never belong in frontend source, compiled Flutter assets, or public pages.
- All external business integrations use least-privilege credentials, explicit scopes, tested revocation, and auditable operations.
- Customer actions that spend money, change payment details, send messages, delete records or deploy changes require separately defined authorisation.
- An internal TrillionAI operator may run an independent Manager tenant or privileged gateway adapter, but no customer subscription entitles access to the internal Ecosystem Core.

## Responsive implementation requirements

Build in **Flutter/Dart** for the approved customer-facing experience, backed by the existing **Node.js/TypeScript** services. Prefer shared visual tokens for all TrillionAI products, including colours, typography, icons, glow effects and card spacing, while keeping product-specific data and permissions isolated.

Do not substitute a static generated mockup for production-ready UI. The finished landing page must:
- Render semantic content and responsive layouts
- Load quickly on modern phones
- Provide keyboard and touch navigation
- Support accessible text, labels, contrast and reduced motion
- Avoid injecting sensitive information into metadata or client logs
- Have working navigation and linked policies
- Track privacy-compliant conversion events with consent where required
- Use only approved offers and genuinely operational CTAs

## Verification and implementation gates

1. Preserve this specification and design reference in the private Manager repository.
2. Build a responsive Flutter landing-page implementation faithful to the reference.
3. Review mockup text against actual product functionality and remove unsupported claims.
4. Verify CTA destinations, registration, email verification, sign-in, entitlement checks and plan billing before activating free trial or checkout.
5. Implement customer-isolated demo content and test for accidental internal information exposure.
6. Run UI tests, responsive/accessible behaviour tests, integration tests, and security reviews.
7. Launch only when commercial promises are demonstrably accurate and production readiness is approved.

**This design lock does not authorise any integration with AppForge, Observability, Identity, or Ecosystem Core.**

## Change control

The customer-facing layout, visual aesthetic, TrillionAI family identity and major section order are **locked** by the owner. Changes to these require explicit approval. Adjust wording, layouts for smaller devices and accessibility where necessary without losing the approved identity.

**Design status is APPROVED. Implementation and live billing remain independently subject to verification.**
