import { createFileRoute } from "@tanstack/react-router";

import { CyberReadinessPage } from "@/views/cyber-readiness";

export const Route = createFileRoute("/_authenticated/app/cyber-readiness")({
  head: () => ({
    meta: [
      { title: "Cyber Readiness | OneGrid" },
      {
        name: "description",
        content:
          "Cyber incident readiness for IT/OT: crown-jewel systems, blast radius in customers, megawatts and dollars, a readiness checklist and a historian-tampering tabletop.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CyberReadinessPage,
});
