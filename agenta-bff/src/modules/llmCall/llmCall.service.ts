import prisma from "../../utils/prisma";

export function getLLMCalls() {
  return prisma.LLMCall.findMany({
    select: {
      id: true,
      prompt: true,
      output: true,
      parameters: true
    },
  });
}
