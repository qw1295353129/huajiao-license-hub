import { useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  Description,
  Drawer,
  Dropdown,
  EmptyState,
  FieldError,
  Form,
  Input,
  Label,
  Link,
  ListBox,
  Menu,
  Modal,
  Pagination,
  Popover,
  ProgressBar,
  SearchField,
  Select,
  Separator,
  Skeleton,
  Spinner,
  Surface,
  Switch,
  Table,
  Tabs,
  Tag,
  TagGroup,
  TextArea,
  TextField,
  Toast,
  Tooltip,
  Typography,
  toast,
  useOverlayState,
} from "@heroui/react";
import type { Key, Selection, SortDescriptor } from "@heroui/react";

/* ------------------------------------------------------------------ */
/* shared fixtures                                                     */
/* ------------------------------------------------------------------ */

type LicenseRow = {
  id: string;
  name: string;
  status: string;
  seats: number;
};

const LICENSE_ROWS: LicenseRow[] = [
  { id: "LIC-1", name: "Acme IDE Pro", status: "active", seats: 12 },
  { id: "LIC-2", name: "Nimbus Analytics", status: "expiring", seats: 4 },
  { id: "LIC-3", name: "Vector Studio", status: "expired", seats: 1 },
];

const PLANS = ["free", "pro", "enterprise"] as const;

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export function ButtonProbe() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="md" onPress={() => toast("Pressed")}>
        Primary
      </Button>
      <Button variant="secondary" size="sm">
        Secondary
      </Button>
      <Button variant="tertiary" size="lg" fullWidth>
        Tertiary full width
      </Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="danger-soft">Danger soft</Button>
      <Button isDisabled>Disabled</Button>
      <Button isIconOnly aria-label="Add license" variant="secondary">
        <span aria-hidden="true">+</span>
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card / Surface / Separator / Skeleton / Spinner / EmptyState        */
/* ------------------------------------------------------------------ */

export function CardProbe() {
  return (
    <Surface variant="secondary" className="p-4">
      <Card variant="default">
        <Card.Header>
          <Card.Title>License overview</Card.Title>
          <Card.Description>Everything you own, in one place.</Card.Description>
        </Card.Header>
        <Card.Content>
          <p>3 licenses tracked.</p>
          <Separator orientation="horizontal" />
          <div className="flex items-center gap-2">
            <Spinner size="sm" color="accent" aria-label="Loading usage" />
            <span>Loading usage…</span>
          </div>
        </Card.Content>
        <Card.Footer>
          <Button size="sm">Manage</Button>
        </Card.Footer>
      </Card>
      <Skeleton animationType="shimmer" className="mt-4 h-4 w-40 rounded" />
      <Skeleton animationType="pulse" className="mt-2 h-4 w-24 rounded" />
      <Skeleton animationType="none" className="mt-2 h-4 w-16 rounded" />
      <EmptyState className="mt-4">No licenses yet</EmptyState>
    </Surface>
  );
}

/* ------------------------------------------------------------------ */
/* Chip / Badge / Avatar / Tag                                         */
/* ------------------------------------------------------------------ */

export function ChipProbe() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Chip color="success" size="sm" variant="soft">
        <Chip.Label>Active</Chip.Label>
      </Chip>
      <Chip color="warning" size="md" variant="primary">
        <Chip.Label>Expiring</Chip.Label>
      </Chip>
      <Chip color="danger" size="lg" variant="secondary">
        <Chip.Label>Expired</Chip.Label>
      </Chip>
      <Chip color="accent" variant="tertiary">
        Accent
      </Chip>

      <Badge.Anchor>
        <Avatar size="md" color="accent" variant="soft">
          <Avatar.Image src="https://i.pravatar.cc/64?img=12" alt="Ada Lovelace" />
          <Avatar.Fallback>AL</Avatar.Fallback>
        </Avatar>
        <Badge color="danger" placement="top-right" size="sm" variant="primary">
          <Badge.Label>3</Badge.Label>
        </Badge>
      </Badge.Anchor>

      <TagGroup size="md" variant="surface">
        <TagGroup.List aria-label="Labels">
          <Tag id="billing" textValue="billing">
            billing
            <Tag.RemoveButton aria-label="Remove billing" />
          </Tag>
          <Tag id="infra" textValue="infra">
            infra
          </Tag>
        </TagGroup.List>
      </TagGroup>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TextField / Input / TextArea / SearchField                          */
/* ------------------------------------------------------------------ */

export function FieldProbe() {
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");

  return (
    <Form onSubmit={(event) => event.preventDefault()}>
      <TextField
        name="email"
        type="email"
        isRequired
        isInvalid={email.length > 0 && !email.includes("@")}
        value={email}
        onChange={setEmail}
        fullWidth
      >
        <Label>Email</Label>
        <Input placeholder="you@example.com" />
        <Description>We never share your address.</Description>
        <FieldError>Enter a valid email address.</FieldError>
      </TextField>

      <TextField name="notes" value={notes} onChange={setNotes}>
        <Label>Notes</Label>
        <TextArea rows={4} placeholder="Free-form notes" variant="secondary" />
        <Description>Markdown is supported.</Description>
      </TextField>

      <SearchField
        value={query}
        onChange={setQuery}
        onSubmit={(value) => toast.info(`Searching ${value}`)}
        fullWidth
        variant="primary"
      >
        <Label>Search</Label>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search licenses" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <Button type="submit" variant="primary">
        Save
      </Button>
    </Form>
  );
}

/* ------------------------------------------------------------------ */
/* Select / ListBox                                                    */
/* ------------------------------------------------------------------ */

export function SelectProbe() {
  const [plan, setPlan] = useState<Key | null>("pro");
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set(["LIC-1"]));

  return (
    <div className="flex flex-col gap-4">
      <Select
        name="plan"
        placeholder="Pick a plan"
        isRequired
        selectedKey={plan}
        onSelectionChange={setPlan}
        fullWidth
      >
        <Label>Plan</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {PLANS.map((item) => (
              <ListBox.Item key={item} id={item} textValue={item}>
                {item}
                <ListBox.Item.Indicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <ListBox
        aria-label="Licenses"
        selectionMode="multiple"
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        items={LICENSE_ROWS}
      >
        {(item: LicenseRow) => (
          <ListBox.Item id={item.id} textValue={item.name}>
            {item.name}
            <ListBox.Item.Indicator />
          </ListBox.Item>
        )}
      </ListBox>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Checkbox / Switch                                                   */
/* ------------------------------------------------------------------ */

export function ToggleProbe() {
  const [agreed, setAgreed] = useState(false);
  const [notify, setNotify] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <Checkbox
        name="agree"
        isSelected={agreed}
        isRequired
        isInvalid={!agreed}
        onChange={setAgreed}
        variant="primary"
      >
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          I accept the terms
        </Checkbox.Content>
        <Description>Required to continue.</Description>
        <FieldError>You must accept the terms.</FieldError>
      </Checkbox>

      <Switch name="notify" isSelected={notify} onChange={setNotify} size="md">
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          Email notifications
        </Switch.Content>
      </Switch>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export function TableProbe() {
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set<Key>());
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor | undefined>(undefined);

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label="Licenses"
          selectionMode="multiple"
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          sortDescriptor={sortDescriptor}
          onSortChange={setSortDescriptor}
        >
          <Table.Header>
            <Table.Column id="name" isRowHeader allowsSorting>
              {({ sortDirection }) => (
                <Table.SortableColumnHeader sortDirection={sortDirection}>Name</Table.SortableColumnHeader>
              )}
            </Table.Column>
            <Table.Column id="status">Status</Table.Column>
            <Table.Column id="seats">Seats</Table.Column>
          </Table.Header>
          <Table.Body
            items={LICENSE_ROWS}
            renderEmptyState={() => <EmptyState>No licenses found</EmptyState>}
          >
            {(item: LicenseRow) => (
              <Table.Row id={item.id}>
                <Table.Cell>{item.name}</Table.Cell>
                <Table.Cell>
                  <Chip color="success" size="sm">
                    {item.status}
                  </Chip>
                </Table.Cell>
                <Table.Cell>{item.seats}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
      <Table.Footer>{selectedKeys === "all" ? "All" : `${selectedKeys.size}`} selected</Table.Footer>
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Modal / Drawer                                                      */
/* ------------------------------------------------------------------ */

export function OverlayProbe() {
  const modalState = useOverlayState();

  return (
    <div className="flex items-center gap-2">
      <Modal state={modalState}>
        <Modal.Trigger>Open modal</Modal.Trigger>
        <Modal.Backdrop isDismissable variant="opaque">
          <Modal.Container size="md" placement="center" scroll="inside">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Revoke license</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <p>This cannot be undone.</p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={modalState.close}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onPress={() => {
                    modalState.close();
                    toast.success("License revoked");
                  }}
                >
                  Revoke
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Drawer>
        <Drawer.Trigger>Open drawer</Drawer.Trigger>
        <Drawer.Backdrop variant="opaque">
          <Drawer.Content placement="right">
            <Drawer.Dialog>
              <Drawer.Header>
                <Drawer.Heading>Filters</Drawer.Heading>
                <Drawer.CloseTrigger />
              </Drawer.Header>
              <Drawer.Body>
                <p>Filter controls go here.</p>
              </Drawer.Body>
              <Drawer.Footer>
                <Drawer.CloseTrigger>Close</Drawer.CloseTrigger>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export function TabsProbe() {
  const [tab, setTab] = useState<Key>("overview");

  return (
    <Tabs
      selectedKey={tab}
      onSelectionChange={setTab}
      variant="primary"
      orientation="horizontal"
      align="start"
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label="License sections">
          <Tabs.Tab id="overview">Overview</Tabs.Tab>
          <Tabs.Tab id="usage">Usage</Tabs.Tab>
          <Tabs.Tab id="seats" isDisabled>
            Seats
          </Tabs.Tab>
          <Tabs.Indicator />
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="overview">Overview panel</Tabs.Panel>
      <Tabs.Panel id="usage">Usage panel</Tabs.Panel>
      <Tabs.Panel id="seats">Seats panel</Tabs.Panel>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */
/* Dropdown / Menu / Tooltip                                           */
/* ------------------------------------------------------------------ */

export function MenuProbe() {
  return (
    <div className="flex items-center gap-2">
      <Dropdown>
        <Dropdown.Trigger>Actions</Dropdown.Trigger>
        <Dropdown.Popover placement="bottom">
          <Dropdown.Menu
            aria-label="License actions"
            onAction={(key) => toast.info(`Action: ${String(key)}`)}
          >
            <Dropdown.Section>
              <Dropdown.Item id="edit" textValue="Edit">
                Edit
              </Dropdown.Item>
              <Dropdown.Item id="duplicate" textValue="Duplicate">
                Duplicate
              </Dropdown.Item>
            </Dropdown.Section>
            <Dropdown.Item id="delete" textValue="Delete" variant="danger">
              Delete
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <Popover>
        <Popover.Trigger>Custom trigger</Popover.Trigger>
        <Popover.Content>
          <Menu aria-label="Standalone menu" onAction={(key) => toast.info(String(key))}>
            <Menu.Item id="one" textValue="One">
              One
            </Menu.Item>
            <Menu.Section aria-label="More">
              <Menu.Item id="two" textValue="Two">
                Two
                <Menu.Item.Indicator type="checkmark" />
              </Menu.Item>
            </Menu.Section>
          </Menu>
        </Popover.Content>
      </Popover>

      <Tooltip delay={200} closeDelay={0}>
        <Tooltip.Trigger>
          <Button variant="secondary">Hover me</Button>
        </Tooltip.Trigger>
        <Tooltip.Content showArrow placement="top">
          Extra context
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination / ProgressBar / Link / Typography                        */
/* ------------------------------------------------------------------ */

export function MiscProbe() {
  const [page, setPage] = useState(1);

  return (
    <div className="flex flex-col gap-4">
      <Pagination size="md">
        <Pagination.Summary>Page {page} of 5</Pagination.Summary>
        <Pagination.Content>
          <Pagination.Item>
            <Pagination.Previous isDisabled={page === 1} onPress={() => setPage((value) => value - 1)}>
              <Pagination.PreviousIcon />
              Prev
            </Pagination.Previous>
          </Pagination.Item>
          <Pagination.Item>
            <Pagination.Link isActive={page === 1} onPress={() => setPage(1)}>
              1
            </Pagination.Link>
          </Pagination.Item>
          <Pagination.Item>
            <Pagination.Ellipsis />
          </Pagination.Item>
          <Pagination.Item>
            <Pagination.Link isActive={page === 5} onPress={() => setPage(5)}>
              5
            </Pagination.Link>
          </Pagination.Item>
          <Pagination.Item>
            <Pagination.Next isDisabled={page === 5} onPress={() => setPage((value) => value + 1)}>
              Next
              <Pagination.NextIcon />
            </Pagination.Next>
          </Pagination.Item>
        </Pagination.Content>
      </Pagination>

      <ProgressBar value={62} minValue={0} maxValue={100} color="accent" size="md" aria-label="Seats used">
        <ProgressBar.Output />
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>

      <Typography.Prose>
        <Typography.Heading level={2}>Licenses</Typography.Heading>
        <Typography.Paragraph size="sm" color="muted">
          Read the <Link href="https://example.com/docs">docs</Link>
          <Link.Icon>↗</Link.Icon> before you start.
        </Typography.Paragraph>
        <Typography.Paragraph>Install with:</Typography.Paragraph>
        <Typography.Code>pnpm add @heroui/react</Typography.Code>
        <Typography type="body-sm" weight="medium" align="start" truncate color="default">
          Truncated single-line summary that never wraps.
        </Typography>
      </Typography.Prose>

      <Alert status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Seat limit reached</Alert.Title>
          <Alert.Description>Buy more seats to invite teammates.</Alert.Description>
        </Alert.Content>
      </Alert>

      <Alert status="success">
        <Alert.Indicator>
          <span aria-hidden="true">✓</span>
        </Alert.Indicator>
        <Alert.Content>
          <Alert.Title>All good</Alert.Title>
          <Alert.Description>Nothing to do.</Alert.Description>
        </Alert.Content>
      </Alert>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

export function ToastProbe() {
  return (
    <>
      <Toast.Provider placement="bottom end" width={420} maxVisibleToasts={3} gap={12} />
      <div className="flex flex-wrap gap-2">
        <Button onPress={() => toast("Plain message")}>Toast</Button>
        <Button onPress={() => toast.success("Saved", { description: "Your changes are live." })}>
          Success
        </Button>
        <Button onPress={() => toast.danger("Failed", { timeout: 0 })}>Danger (sticky)</Button>
        <Button onPress={() => toast.info("Heads up")}>Info</Button>
        <Button onPress={() => toast.warning("Careful")}>Warning</Button>
        <Button
          onPress={() =>
            toast.promise(Promise.resolve("done"), {
              loading: "Saving…",
              success: (data: string) => `Saved: ${data}`,
              error: (error: Error) => error.message,
            })
          }
        >
          Promise
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Aggregated probe                                                    */
/* ------------------------------------------------------------------ */

export default function HeroUiProbe() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <ToastProbe />
      <ButtonProbe />
      <CardProbe />
      <ChipProbe />
      <FieldProbe />
      <SelectProbe />
      <ToggleProbe />
      <TableProbe />
      <OverlayProbe />
      <TabsProbe />
      <MenuProbe />
      <MiscProbe />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toast (custom rendering)                                            */
/*                                                                     */
/* Alternative to the default mount above: the provider children is a  */
/* render prop receiving the queued toast. Mount ONE provider per app; */
/* this probe is exported but intentionally not rendered by default.   */
/* ------------------------------------------------------------------ */

export function ToastCustomProbe() {
  return (
    <Toast.Provider placement="top end" isExpanded>
      {({ toast: queued }) => (
        <Toast toast={queued} variant={queued.content.variant}>
          <Toast.Indicator />
          <Toast.Content>
            <Toast.Title>Custom title</Toast.Title>
            <Toast.Description>Custom body</Toast.Description>
          </Toast.Content>
          <Toast.ActionButton>Undo</Toast.ActionButton>
          <Toast.CloseButton />
        </Toast>
      )}
    </Toast.Provider>
  );
}


/* ------------------------------------------------------------------ */
/* Table (data-driven columns via Table.Header)                        */
/* ------------------------------------------------------------------ */

type ColumnDef = { id: string; label: string; isRowHeader?: boolean };

const LICENSE_COLUMNS: ColumnDef[] = [
  { id: "name", label: "Name", isRowHeader: true },
  { id: "status", label: "Status" },
];

export function TableDataDrivenProbe() {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Licenses (data driven)">
          <Table.Header columns={LICENSE_COLUMNS}>
            {(column: ColumnDef) => (
              <Table.Column id={column.id} isRowHeader={column.isRowHeader}>
                {column.label}
              </Table.Column>
            )}
          </Table.Header>
          <Table.Body items={LICENSE_ROWS}>
            {(item: LicenseRow) => (
              <Table.Row id={item.id}>
                <Table.Cell>{item.name}</Table.Cell>
                <Table.Cell>{item.status}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

