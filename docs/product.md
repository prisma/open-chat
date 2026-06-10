# Product

## Register

product

## Users

Open Chat serves two overlapping groups. Developers use it to learn how Prisma Streams fits a real chat workload with auth, metadata, durable message logs, and local development. Chat users use it as a fast multi-chat OpenRouter client where response streaming feels immediate and survives refreshes.

## Product Purpose

The product demonstrates a clean architecture for durable AI chat: Postgres stores users and chat metadata, Prisma Streams stores message events, Bun enforces the auth boundary, TanStack DB drives the UI, and OpenRouter supplies models. Success means the app is understandable as source code and credible as a daily-use chat surface.

## Brand Personality

Pragmatic, precise, responsive. The interface should feel like a serious developer tool with a polished consumer-chat rhythm: quiet enough for long sessions, clear enough to teach from, and fast enough that streaming feels alive without spectacle.

## Anti-references

Avoid marketing-page composition, decorative card grids, oversized hero sections, dark gradient SaaS wallpaper, glass effects, and chat UI that hides durable-streaming mechanics behind vague abstractions. Avoid novelty controls, unclear labels, and any visual treatment that makes the project look like a quick demo.

## Design Principles

1. Make the architecture legible: key surfaces should reflect chats, messages, models, and stream status without explanatory clutter.
2. Preserve momentum: creating chats, switching context, selecting models, and sending prompts should require few steps.
3. Stream honestly: assistant output should appear from durable events, with explicit reconnect and error states.
4. Favor dense clarity: this is an app surface for repeated use, so scanability beats decoration.
5. Keep the code teachable: UI patterns should be direct, named plainly, and avoid clever abstractions.

## Accessibility & Inclusion

Target WCAG AA contrast for text and controls. Preserve full keyboard access for auth, chat selection, model search, rename, and composer flows. Honor reduced-motion preferences, avoid color-only state communication, and keep touch targets usable on mobile.

