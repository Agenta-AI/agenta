# Agent platform instructions

Keep Agenta's shared instructions in one SDK module and deliver them through the
runner's existing instruction paths. This cleanup adds a short common base, moves
gateway guidance out of the bundled skills module, and removes the SDK's
delivery-choice wrapper. Author configuration stays separate from generated text.

- [Context](./context.md): problem and scope.
- [Plan](./plan.md): implementation, rollout, and checks.
- [Research](./research.md): existing implementation.
- [Status](./status.md): progress and verification.
