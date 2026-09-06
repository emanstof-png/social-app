import type { LlmComponent } from "../../schemas/enums";
import type { ComponentDefinition } from "../component";

import { activitySuggestionComponent } from "./activity-suggestion";
import { discoveryResearchComponent } from "./discovery-research";
import { eventExtractionComponent } from "./event-extraction";
import { interviewComponent } from "./interview";
import { inviteSuggestionComponent } from "./invite-suggestion";
import { personaSynthesisComponent } from "./persona-synthesis";
import { weeklyPlanningComponent } from "./weekly-planning";

/**
 * The component registry the gateway resolves against. One entry per member of
 * the llm_component enum; the exhaustive Record type means adding a component
 * to the enum without defining it here is a compile error.
 */
export const COMPONENT_REGISTRY: Record<LlmComponent, ComponentDefinition> = {
  interview: interviewComponent,
  persona_synthesis: personaSynthesisComponent,
  activity_suggestion: activitySuggestionComponent,
  discovery_research: discoveryResearchComponent,
  event_extraction: eventExtractionComponent,
  weekly_planning: weeklyPlanningComponent,
  invite_suggestion: inviteSuggestionComponent,
};

export function componentDefinition(id: LlmComponent): ComponentDefinition {
  const definition = COMPONENT_REGISTRY[id];
  if (!definition) {
    throw new Error(
      `No component definition registered for "${id}". Add one in lib/llm/components/.`,
    );
  }
  return definition;
}
