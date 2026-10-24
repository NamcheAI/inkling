import { Button, CodeSnippet, CopyButton, Stack, Tabs, Text } from "@earendil-works/elanor-react";

import { Dialog } from "./dialog.tsx";
import styles from "./agent-access-dialog.module.css";

export interface AgentAccessDialogProps {
  readonly onClose: () => void;
  readonly onOpenApiKeys: () => void;
}

interface AgentSetup {
  readonly id: string;
  readonly name: string;
  readonly add: string;
  readonly login: string;
  readonly note: string;
}

const serverName = "inkling";

function agentSetups(endpoint: string): readonly AgentSetup[] {
  return [
    {
      id: "pi",
      name: "Pi",
      add: `pi mcp add ${serverName} --url ${endpoint}`,
      login: `pi mcp login ${serverName}`,
      note: "In a running session, run /reload to pick up the server, or /mcp to sign in.",
    },
    {
      id: "claude",
      name: "Claude Code",
      add: `claude mcp add --scope user --transport http ${serverName} ${endpoint}`,
      login: `claude mcp login ${serverName}`,
      note: "Restart running sessions, or run /mcp inside Claude Code to sign in.",
    },
    {
      id: "codex",
      name: "Codex",
      add: `codex mcp add ${serverName} --url ${endpoint}`,
      login: `codex mcp login ${serverName}`,
      note: "Restart running sessions to load the server.",
    },
  ];
}

export function AgentAccessDialog({
  onClose,
  onOpenApiKeys,
}: AgentAccessDialogProps): React.JSX.Element {
  const setups = agentSetups(`${location.origin}/mcp`);
  return (
    <Dialog
      attributes={{ "data-agent-access-dialog": "" }}
      closeLabel="Close agent access"
      onClose={onClose}
      open
      title="Agent access"
    >
      <Stack align="stretch" gap="large">
        <Text className={styles["note"]} data-agent-access-note="">
          Connect a coding agent to this workspace through MCP. Signing in opens Inkling in your
          browser to approve access. The agent acts with your permissions.
        </Text>
        <Tabs.Root defaultValue={setups[0]?.id}>
          <Tabs.List aria-label="Coding agent">
            {setups.map((setup) => (
              <Tabs.Tab data-agent-tab={setup.id} key={setup.id} value={setup.id}>
                {setup.name}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator />
          </Tabs.List>
          {setups.map((setup) => (
            <Tabs.Panel data-agent-setup={setup.id} key={setup.id} value={setup.id}>
              <div className={styles["panel"]}>
                <SetupStep command={setup.add} label="Add the server" />
                <SetupStep command={setup.login} label="Sign in" />
                <Text className={styles["note"]}>{setup.note}</Text>
              </div>
            </Tabs.Panel>
          ))}
        </Tabs.Root>
        <Stack align="center" direction="row" gap="auto" wrap="wrap">
          <Text className={styles["note"]}>Connected agents are listed under API keys.</Text>
          <Button data-agent-access-api-keys="" hierarchy="secondary" onClick={onOpenApiKeys}>
            Manage API keys
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

function SetupStep({
  command,
  label,
}: {
  readonly command: string;
  readonly label: string;
}): React.JSX.Element {
  return (
    <Stack align="stretch" gap="xSmall">
      <Text className={styles["step"]}>{label}</Text>
      <CodeSnippet
        actions={<CopyButton aria-label={`Copy command: ${label}`} value={command} />}
        data-agent-command=""
      >
        {command}
      </CodeSnippet>
    </Stack>
  );
}
