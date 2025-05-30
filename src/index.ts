/**
 * GitHub Projects MCP Server - TypeScript Implementation
 * Provides comprehensive GitHub Projects V2 management capabilities
 */

import dotenv from "dotenv";
import { existsSync } from "fs";

// Load environment variables from .env files
// Priority: .env.local > .env
if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
} else if (existsSync('.env')) {
  dotenv.config({ path: '.env' });
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";

// Zod schemas for input validation
const CreateProjectSchema = z.object({
  title: z.string().describe("Project title"),
  description: z.string().optional().describe("Project description"),
  owner: z.string().describe("Owner (username or organization name)"),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PRIVATE").describe("Project visibility"),
});

const GetProjectSchema = z.object({
  projectId: z.string().describe("Project ID"),
});

const UpdateProjectSchema = z.object({
  projectId: z.string().describe("Project ID"),
  title: z.string().optional().describe("New project title"),
  description: z.string().optional().describe("New project description"),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional().describe("New project visibility"),
});

const CreateIssueSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  title: z.string().describe("Issue title"),
  body: z.string().optional().describe("Issue body"),
  projectId: z.string().optional().describe("Project ID to add the issue to"),
});

const AddItemToProjectSchema = z.object({
  projectId: z.string().describe("Project ID"),
  contentId: z.string().describe("Issue or PR node ID"),
});

const UpdateProjectItemSchema = z.object({
  projectId: z.string().describe("Project ID"),
  itemId: z.string().describe("Project item ID"),
  fieldId: z.string().describe("Field ID to update"),
  value: z.string().describe("New field value"),
  fieldType: z.enum(["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION"]).optional().describe("Field type (auto-detected if not provided)"),
});

const CreateProjectFieldSchema = z.object({
  projectId: z.string().describe("Project ID"),
  name: z.string().describe("Field name"),
  dataType: z.enum(["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION"]).describe("Field data type"),
  options: z.array(z.string()).optional().describe("Options for single select field"),
});

const UpdateItemStatusSchema = z.object({
  projectId: z.string().describe("Project ID"),
  itemId: z.string().describe("Project item ID"),
  status: z.string().describe("New status (e.g., 'Todo', 'In Progress', 'Done')"),
});

const GetProjectFieldsSchema = z.object({
  projectId: z.string().describe("Project ID"),
});

const GetProjectItemsSchema = z.object({
  projectId: z.string().describe("Project ID"),
  limit: z.number().optional().default(20).describe("Number of items to fetch (default: 20, max: 100)"),
});

// Type definitions for GraphQL responses
interface ProjectNode {
  id: string;
  number: number;
  title: string;
  shortDescription?: string;
  public: boolean;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  url: string;
  fields?: {
    nodes: Array<{
      id: string;
      name: string;
      dataType: string;
      options?: Array<{ id: string; name: string }>;
    }>;
  };
  items?: {
    nodes: Array<{
      id: string;
      type: string;
      content?: {
        __typename?: string;
        id: string;
        number?: number;
        title: string;
        state?: string;
        url?: string;
        body?: string;
      };
      fieldValues?: {
        nodes: Array<{
          text?: string;
          name?: string;
          field?: {
            id: string;
            name: string;
          };
        }>;
      };
    }>;
  };
}

interface UserProjectsResponse {
  user?: {
    projectsV2?: {
      nodes: ProjectNode[];
    };
  };
}

interface OrgProjectsResponse {
  organization?: {
    projectsV2?: {
      nodes: ProjectNode[];
    };
  };
}

interface ProjectDetailsResponse {
  node?: ProjectNode;
}

interface CreateProjectResponse {
  createProjectV2: {
    projectV2: ProjectNode;
  };
}

interface UpdateProjectResponse {
  updateProjectV2: {
    projectV2: ProjectNode;
  };
}

interface AddItemResponse {
  addProjectV2ItemById: {
    item: {
      id: string;
    };
  };
}

interface UpdateItemResponse {
  updateProjectV2ItemFieldValue: {
    projectV2Item: {
      id: string;
    };
  };
}

interface CreateFieldResponse {
  createProjectV2Field: {
    projectV2Field: {
      id: string;
      name: string;
      dataType: string;
    };
  };
}

interface UserIdResponse {
  user?: {
    id: string;
  };
}

interface OrgIdResponse {
  organization?: {
    id: string;
  };
}

// GraphQL queries and mutations
const GRAPHQL_QUERIES = {
  GET_USER_PROJECTS: `
    query GetUserProjects($login: String!, $first: Int = 10) {
      user(login: $login) {
        projectsV2(first: $first) {
          nodes {
            id
            number
            title
            shortDescription
            public
            closed
            createdAt
            updatedAt
            url
          }
        }
      }
    }
  `,
  
  GET_ORG_PROJECTS: `
    query GetOrgProjects($login: String!, $first: Int = 10) {
      organization(login: $login) {
        projectsV2(first: $first) {
          nodes {
            id
            number
            title
            shortDescription
            public
            closed
            createdAt
            updatedAt
            url
          }
        }
      }
    }
  `,

  GET_PROJECT_DETAILS: `
    query GetProjectDetails($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          id
          number
          title
          shortDescription
          public
          closed
          createdAt
          updatedAt
          url
          fields(first: 20) {
            nodes {
              ... on ProjectV2Field {
                id
                name
                dataType
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                options {
                  id
                  name
                }
              }
            }
          }
          items(first: 50) {
            nodes {
              id
              type
              content {
                ... on Issue {
                  id
                  number
                  title
                  state
                  url
                }
                ... on PullRequest {
                  id
                  number
                  title
                  state
                  url
                }
                ... on DraftIssue {
                  id
                  title
                  body
                }
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldTextValue {
                    text
                    field {
                      ... on ProjectV2Field {
                        id
                        name
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `,

  CREATE_PROJECT: `
    mutation CreateProject($ownerId: ID!, $title: String!, $description: String, $visibility: ProjectV2Visibility!) {
      createProjectV2(input: {
        ownerId: $ownerId
        title: $title
        shortDescription: $description
        visibility: $visibility
      }) {
        projectV2 {
          id
          number
          title
          shortDescription
          url
        }
      }
    }
  `,

  UPDATE_PROJECT: `
    mutation UpdateProject($projectId: ID!, $title: String, $description: String, $visibility: ProjectV2Visibility) {
      updateProjectV2(input: {
        projectId: $projectId
        title: $title
        shortDescription: $description
        public: $visibility
      }) {
        projectV2 {
          id
          title
          shortDescription
          public
        }
      }
    }
  `,

  ADD_ITEM_TO_PROJECT: `
    mutation AddItemToProject($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {
        projectId: $projectId
        contentId: $contentId
      }) {
        item {
          id
        }
      }
    }
  `,

  UPDATE_PROJECT_ITEM_FIELD: `
    mutation UpdateProjectItemField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: $value
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,

  CREATE_PROJECT_FIELD: `
    mutation CreateProjectField($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!) {
      createProjectV2Field(input: {
        projectId: $projectId
        name: $name
        dataType: $dataType
      }) {
        projectV2Field {
          ... on ProjectV2Field {
            id
            name
            dataType
          }
        }
      }
    }
  `,

  GET_USER_ID: `
    query GetUserId($login: String!) {
      user(login: $login) {
        id
      }
    }
  `,

  GET_ORG_ID: `
    query GetOrgId($login: String!) {
      organization(login: $login) {
        id
      }
    }
  `,

  GET_PROJECT_FIELDS_DETAILED: `
    query GetProjectFieldsDetailed($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          id
          title
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field {
                id
                name
                dataType
                createdAt
                updatedAt
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                createdAt
                updatedAt
                options {
                  id
                  name
                  description
                  color
                }
              }
              ... on ProjectV2IterationField {
                id
                name
                dataType
                createdAt
                updatedAt
                configuration {
                  iterations {
                    id
                    title
                    duration
                    startDate
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
};


class GitHubProjectsServer {
  private server: Server;
  private graphqlClient: typeof graphql;
  private restClient: Octokit;

  constructor() {
    this.server = new Server(
      {
        name: "github-projects-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize clients with token from environment
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    this.graphqlClient = graphql.defaults({
      headers: {
        authorization: `token ${token}`,
      },
    });

    this.restClient = new Octokit({
      auth: token,
    });

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list-projects",
          description: "List GitHub Projects for a user or organization",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Username or organization name",
              },
              type: {
                type: "string",
                enum: ["user", "organization"],
                description: "Type of owner (user or organization)",
                default: "user",
              },
            },
            required: ["owner"],
          },
        },
        {
          name: "get-project",
          description: "Get detailed information about a GitHub Project",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID",
              },
            },
            required: ["projectId"],
          },
        },
        {
          name: "create-project",
          description: "Create a new GitHub Project",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Project title",
              },
              description: {
                type: "string",
                description: "Project description",
              },
              owner: {
                type: "string",
                description: "Owner (username or organization name)",
              },
              visibility: {
                type: "string",
                enum: ["PUBLIC", "PRIVATE"],
                description: "Project visibility",
                default: "PRIVATE",
              },
            },
            required: ["title", "owner"],
          },
        },
        {
          name: "update-project",
          description: "Update an existing GitHub Project",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID",
              },
              title: {
                type: "string",
                description: "New project title",
              },
              description: {
                type: "string",
                description: "New project description",
              },
              visibility: {
                type: "string",
                enum: ["PUBLIC", "PRIVATE"],
                description: "New project visibility",
              },
            },
            required: ["projectId"],
          },
        },
        {
          name: "create-issue",
          description: "Create a GitHub issue and optionally add to project",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner",
              },
              repo: {
                type: "string",
                description: "Repository name",
              },
              title: {
                type: "string",
                description: "Issue title",
              },
              body: {
                type: "string",
                description: "Issue body",
              },
              projectId: {
                type: "string",
                description: "Project ID to add the issue to",
              },
            },
            required: ["owner", "repo", "title"],
          },
        },
        {
          name: "add-item-to-project",
          description: "Add an existing issue or PR to a project",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID",
              },
              contentId: {
                type: "string",
                description: "Issue or PR node ID",
              },
            },
            required: ["projectId", "contentId"],
          },
        },
        {
          name: "update-project-item",
          description: "Update a field value for a project item (supports text, number, date, single select, and iteration fields)",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID",
              },
              itemId: {
                type: "string",
                description: "Project item ID",
              },
              fieldId: {
                type: "string",
                description: "Field ID to update",
              },
              value: {
                type: "string",
                description: "New field value (for single select: option name like 'Todo', 'In Progress', 'Done')",
              },
              fieldType: {
                type: "string",
                enum: ["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION"],
                description: "Field type (auto-detected if not provided)",
              },
            },
            required: ["projectId", "itemId", "fieldId", "value"],
          },
        },
        {
          name: "create-project-field",
          description: "Create a new field in a project",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID",
              },
              name: {
                type: "string",
                description: "Field name",
              },
              dataType: {
                type: "string",
                enum: ["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION"],
                description: "Field data type",
              },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Options for single select field",
              },
            },
            required: ["projectId", "name", "dataType"],
          },
        },
        {
          name: "update-item-status",
          description: "Update the status of a project item (shortcut for status field updates)",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID",
              },
              itemId: {
                type: "string",
                description: "Project item ID",
              },
              status: {
                type: "string",
                description: "New status (e.g., 'Todo', 'In Progress', 'Done')",
              },
            },
            required: ["projectId", "itemId", "status"],
          },
        },
        {
          name: "get-project-fields",
          description: "Get detailed information about all fields in a project including options for single select fields",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID",
              },
            },
            required: ["projectId"],
          },
        },
        {
          name: "get-project-items",
          description: "Get all items in a project with their current field values and status",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID",
              },
              limit: {
                type: "number",
                description: "Number of items to fetch (default: 20, max: 100)",
                default: 20,
                minimum: 1,
                maximum: 100,
              },
            },
            required: ["projectId"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "list-projects":
            return await this.listProjects(args);
          case "get-project":
            return await this.getProject(args);
          case "create-project":
            return await this.createProject(args);
          case "update-project":
            return await this.updateProject(args);
          case "create-issue":
            return await this.createIssue(args);
          case "add-item-to-project":
            return await this.addItemToProject(args);
          case "update-project-item":
            return await this.updateProjectItem(args);
          case "create-project-field":
            return await this.createProjectField(args);
          case "update-item-status":
            return await this.updateItemStatus(args);
          case "get-project-fields":
            return await this.getProjectFields(args);
          case "get-project-items":
            return await this.getProjectItems(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid arguments: ${error.errors.map(e => e.message).join(", ")}`
          );
        }
        throw error;
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async listProjects(args: any) {
    const { owner, type = "user" } = args;
    
    try {
      const query = type === "organization" ? GRAPHQL_QUERIES.GET_ORG_PROJECTS : GRAPHQL_QUERIES.GET_USER_PROJECTS;
      const result = await this.graphqlClient(query, { login: owner });
      
      const projects = type === "organization" 
        ? (result as OrgProjectsResponse).organization?.projectsV2?.nodes || []
        : (result as UserProjectsResponse).user?.projectsV2?.nodes || [];

      return {
        content: [
          {
            type: "text",
            text: `Projects for ${owner}:\n\n${projects.map((project: ProjectNode) => 
              `• ${project.title} (#${project.number})\n` +
              `  ID: ${project.id}\n` +
              `  Description: ${project.shortDescription || 'No description'}\n` +
              `  Visibility: ${project.public ? 'Public' : 'Private'}\n` +
              `  Status: ${project.closed ? 'Closed' : 'Open'}\n` +
              `  URL: ${project.url}\n`
            ).join('\n')}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing projects: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async getProject(args: any) {
    const { projectId } = GetProjectSchema.parse(args);
    
    try {
      const result = await this.graphqlClient(GRAPHQL_QUERIES.GET_PROJECT_DETAILS, { projectId });
      const project = (result as ProjectDetailsResponse).node;

      if (!project) {
        throw new Error("Project not found");
      }

      return {
        content: [
          {
            type: "text",
            text: `Project Details:\n\n` +
              `Title: ${project.title}\n` +
              `ID: ${project.id}\n` +
              `Number: #${project.number}\n` +
              `Description: ${project.shortDescription || 'No description'}\n` +
              `Visibility: ${project.public ? 'Public' : 'Private'}\n` +
              `Status: ${project.closed ? 'Closed' : 'Open'}\n` +
              `URL: ${project.url}\n\n` +
              `Fields (${project.fields?.nodes?.length || 0}):\n${(project.fields?.nodes || []).map((field: any) => 
                `• ${field.name} (${field.dataType}) - ID: ${field.id}\n`
              ).join('')}\n` +
              `Items (${project.items?.nodes?.length || 0}):\n${(project.items?.nodes || []).map((item: any) => {
                const content = item.content;
                if (content) {
                  if (content.__typename === 'Issue' || content.__typename === 'PullRequest') {
                    return `• ${content.title} (#${content.number}) - ${content.state}\n  URL: ${content.url}\n`;
                  } else if (content.__typename === 'DraftIssue') {
                    return `• ${content.title} (Draft)\n`;
                  }
                }
                return `• Item ID: ${item.id}\n`;
              }).join('')}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting project: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async createProject(args: any) {
    const { title, description, owner, visibility } = CreateProjectSchema.parse(args);
    
    try {
      // Get owner ID
      let ownerId;
      try {
        const userResult = await this.graphqlClient(GRAPHQL_QUERIES.GET_USER_ID, { login: owner });
        ownerId = (userResult as UserIdResponse).user?.id;
      } catch {
        const orgResult = await this.graphqlClient(GRAPHQL_QUERIES.GET_ORG_ID, { login: owner });
        ownerId = (orgResult as OrgIdResponse).organization?.id;
      }

      if (!ownerId) {
        throw new Error(`Owner '${owner}' not found`);
      }

      const result = await this.graphqlClient(GRAPHQL_QUERIES.CREATE_PROJECT, {
        ownerId,
        title,
        description,
        visibility,
      });

      const project = (result as CreateProjectResponse).createProjectV2.projectV2;

      return {
        content: [
          {
            type: "text",
            text: `Project created successfully!\n\n` +
              `Title: ${project.title}\n` +
              `ID: ${project.id}\n` +
              `Number: #${project.number}\n` +
              `Description: ${project.shortDescription || 'No description'}\n` +
              `URL: ${project.url}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating project: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async updateProject(args: any) {
    const { projectId, title, description, visibility } = UpdateProjectSchema.parse(args);
    
    try {
      const result = await this.graphqlClient(GRAPHQL_QUERIES.UPDATE_PROJECT, {
        projectId,
        title,
        description,
        visibility,
      });

      const project = (result as UpdateProjectResponse).updateProjectV2.projectV2;

      return {
        content: [
          {
            type: "text",
            text: `Project updated successfully!\n\n` +
              `Title: ${project.title}\n` +
              `ID: ${project.id}\n` +
              `Description: ${project.shortDescription || 'No description'}\n` +
              `Visibility: ${project.public ? 'Public' : 'Private'}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error updating project: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async createIssue(args: any) {
    const { owner, repo, title, body, projectId } = CreateIssueSchema.parse(args);
    
    try {
      // Create issue using REST API
      const issue = await this.restClient.issues.create({
        owner,
        repo,
        title,
        body,
      });

      let result = `Issue created successfully!\n\n` +
        `Title: ${issue.data.title}\n` +
        `Number: #${issue.data.number}\n` +
        `URL: ${issue.data.html_url}\n` +
        `Node ID: ${issue.data.node_id}`;

      // Add to project if projectId is provided
      if (projectId && issue.data.node_id) {
        try {
          await this.graphqlClient(GRAPHQL_QUERIES.ADD_ITEM_TO_PROJECT, {
            projectId,
            contentId: issue.data.node_id,
          });
          result += `\n\nIssue added to project successfully!`;
        } catch (error) {
          result += `\n\nWarning: Could not add issue to project: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating issue: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async addItemToProject(args: any) {
    const { projectId, contentId } = AddItemToProjectSchema.parse(args);
    
    try {
      const result = await this.graphqlClient(GRAPHQL_QUERIES.ADD_ITEM_TO_PROJECT, {
        projectId,
        contentId,
      });

      return {
        content: [
          {
            type: "text",
            text: `Item added to project successfully!\n\nItem ID: ${(result as AddItemResponse).addProjectV2ItemById.item.id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error adding item to project: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async updateProjectItem(args: any) {
    const { projectId, itemId, fieldId, value, fieldType } = UpdateProjectItemSchema.parse(args);
    
    try {
      // If fieldType is not provided, try to detect it by getting field information
      let actualFieldType = fieldType;
      if (!actualFieldType) {
        try {
          const projectResult = await this.graphqlClient(GRAPHQL_QUERIES.GET_PROJECT_DETAILS, { projectId });
          const project = (projectResult as ProjectDetailsResponse).node;
          const field = project?.fields?.nodes?.find((f: any) => f.id === fieldId);
          actualFieldType = field?.dataType as any;
        } catch {
          // Default to TEXT if detection fails
          actualFieldType = "TEXT";
        }
      }

      // Format value based on field type
      let formattedValue: any;
      switch (actualFieldType) {
        case "TEXT":
          formattedValue = { text: value };
          break;
        case "NUMBER":
          formattedValue = { number: parseFloat(value) };
          break;
        case "DATE":
          formattedValue = { date: value }; // ISO date string
          break;
        case "SINGLE_SELECT":
          // For single select, we need to find the option ID by name
          try {
            const projectResult = await this.graphqlClient(GRAPHQL_QUERIES.GET_PROJECT_DETAILS, { projectId });
            const project = (projectResult as ProjectDetailsResponse).node;
            const field = project?.fields?.nodes?.find((f: any) => f.id === fieldId);
            const option = field?.options?.find((opt: any) => opt.name.toLowerCase() === value.toLowerCase());
            if (option) {
              formattedValue = { singleSelectOptionId: option.id };
            } else {
              throw new Error(`Option '${value}' not found for field. Available options: ${field?.options?.map((opt: any) => opt.name).join(', ')}`);
            }
          } catch (error) {
            throw new Error(`Failed to find single select option: ${error instanceof Error ? error.message : String(error)}`);
          }
          break;
        case "ITERATION":
          formattedValue = { iterationId: value };
          break;
        default:
          formattedValue = { text: value };
      }

      const result = await this.graphqlClient(GRAPHQL_QUERIES.UPDATE_PROJECT_ITEM_FIELD, {
        projectId,
        itemId,
        fieldId,
        value: formattedValue,
      });

      return {
        content: [
          {
            type: "text",
            text: `Project item field updated successfully!\n\n` +
              `Item ID: ${(result as UpdateItemResponse).updateProjectV2ItemFieldValue.projectV2Item.id}\n` +
              `Field Type: ${actualFieldType}\n` +
              `New Value: ${value}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error updating project item: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async createProjectField(args: any) {
    const { projectId, name, dataType } = CreateProjectFieldSchema.parse(args);
    
    try {
      const result = await this.graphqlClient(GRAPHQL_QUERIES.CREATE_PROJECT_FIELD, {
        projectId,
        name,
        dataType,
      });

      const field = (result as CreateFieldResponse).createProjectV2Field.projectV2Field;

      return {
        content: [
          {
            type: "text",
            text: `Project field created successfully!\n\n` +
              `Name: ${field.name}\n` +
              `ID: ${field.id}\n` +
              `Type: ${field.dataType}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating project field: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async updateItemStatus(args: any) {
    const { projectId, itemId, status } = UpdateItemStatusSchema.parse(args);
    
    try {
      // Get project details to find the Status field
      const projectResult = await this.graphqlClient(GRAPHQL_QUERIES.GET_PROJECT_DETAILS, { projectId });
      const project = (projectResult as ProjectDetailsResponse).node;
      
      if (!project) {
        throw new Error("Project not found");
      }
      
      // Find the Status field (common field names: "Status", "State", "Column")
      const statusField = project.fields?.nodes?.find((field: any) => 
        field.name.toLowerCase().includes('status') || 
        field.name.toLowerCase().includes('state') || 
        field.name.toLowerCase().includes('column')
      );
      
      if (!statusField) {
        throw new Error("No status field found. Available fields: " + 
          (project.fields?.nodes?.map((f: any) => f.name).join(', ') || 'none'));
      }
      
      // Find the option by name
      const option = statusField.options?.find((opt: any) => 
        opt.name.toLowerCase() === status.toLowerCase()
      );
      
      if (!option) {
        throw new Error(`Status '${status}' not found. Available statuses: ${statusField.options?.map((opt: any) => opt.name).join(', ')}`);
      }
      
      // Update the status
      const result = await this.graphqlClient(GRAPHQL_QUERIES.UPDATE_PROJECT_ITEM_FIELD, {
        projectId,
        itemId,
        fieldId: statusField.id,
        value: { singleSelectOptionId: option.id },
      });
      
      return {
        content: [
          {
            type: "text",
            text: `Status updated successfully!\n\n` +
              `Item ID: ${(result as UpdateItemResponse).updateProjectV2ItemFieldValue.projectV2Item.id}\n` +
              `Field: ${statusField.name}\n` +
              `New Status: ${status}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error updating status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async getProjectFields(args: any) {
    const { projectId } = GetProjectFieldsSchema.parse(args);
    
    try {
      const result = await this.graphqlClient(GRAPHQL_QUERIES.GET_PROJECT_FIELDS_DETAILED, { projectId });
      const project = (result as ProjectDetailsResponse).node;
      
      if (!project) {
        throw new Error("Project not found");
      }
      
      const fields = project.fields?.nodes || [];
      
      if (fields.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No custom fields found in this project.",
            },
          ],
        };
      }
      
      const fieldDetails = fields.map((field: any) => {
        let fieldInfo = `• **${field.name}**\n` +
          `  - ID: \`${field.id}\`\n` +
          `  - Type: ${field.dataType}\n` +
          `  - Created: ${new Date(field.createdAt).toLocaleDateString()}\n`;
        
        // Add options for single select fields
        if (field.dataType === 'SINGLE_SELECT' && field.options) {
          fieldInfo += `  - Options (${field.options.length}):\n`;
          field.options.forEach((option: any, index: number) => {
            fieldInfo += `    ${index + 1}. "${option.name}" (ID: \`${option.id}\`)`;
            if (option.color) fieldInfo += ` 🎨${option.color}`;
            if (option.description) fieldInfo += ` - ${option.description}`;
            fieldInfo += '\n';
          });
        }
        
        // Add iteration information
        if (field.dataType === 'ITERATION' && field.configuration?.iterations) {
          fieldInfo += `  - Iterations (${field.configuration.iterations.length}):\n`;
          field.configuration.iterations.forEach((iteration: any, index: number) => {
            fieldInfo += `    ${index + 1}. "${iteration.title}" (${iteration.duration} days)`;
            if (iteration.startDate) fieldInfo += ` - Starts: ${new Date(iteration.startDate).toLocaleDateString()}`;
            fieldInfo += '\n';
          });
        }
        
        return fieldInfo;
      }).join('\n');
      
      return {
        content: [
          {
            type: "text",
            text: `Project Fields for ${project.title}:\n\n` +
              `Total Fields: ${fields.length}\n\n` +
              fieldDetails +
              `\n\n**Usage Examples:**\n` +
              `- Text field: \`{"fieldId": "field_id", "value": "text", "fieldType": "TEXT"}\`\n` +
              `- Status field: \`{"fieldId": "field_id", "value": "option_name", "fieldType": "SINGLE_SELECT"}\`\n` +
              `- Quick status update: \`{"projectId": "${projectId}", "itemId": "item_id", "status": "option_name"}\`\n\n` +
              `**Built-in Fields:**\n` +
              `- Title: Always available for all items\n` +
              `- Assignees: Built-in user assignment field\n` +
              `- Status: Default status tracking field\n` +
              `- Labels: Built-in labeling system`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting project fields: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async getProjectItems(args: any) {
    const { projectId, limit } = GetProjectItemsSchema.parse(args);
    
    try {
      // Get project details with items
      const result = await this.graphqlClient(`
        query GetProjectItems($projectId: ID!, $first: Int!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              id
              title
              items(first: $first) {
                nodes {
                  id
                  type
                  content {
                    ... on Issue {
                      id
                      number
                      title
                      state
                      url
                      assignees(first: 5) {
                        nodes {
                          login
                        }
                      }
                    }
                    ... on PullRequest {
                      id
                      number
                      title
                      state
                      url
                      assignees(first: 5) {
                        nodes {
                          login
                        }
                      }
                    }
                    ... on DraftIssue {
                      id
                      title
                      body
                    }
                  }
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldTextValue {
                        text
                        field {
                          ... on ProjectV2Field {
                            id
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldNumberValue {
                        number
                        field {
                          ... on ProjectV2Field {
                            id
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldDateValue {
                        date
                        field {
                          ... on ProjectV2Field {
                            id
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field {
                          ... on ProjectV2SingleSelectField {
                            id
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldIterationValue {
                        title
                        field {
                          ... on ProjectV2IterationField {
                            id
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `, { projectId, first: limit });
      
      const project = (result as any).node;
      
      if (!project) {
        throw new Error("Project not found");
      }
      
      const items = project.items?.nodes || [];
      
      if (items.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No items found in project "${project.title}".`,
            },
          ],
        };
      }
      
      const itemDetails = items.map((item: any, index: number) => {
        const content = item.content;
        let itemInfo = `**${index + 1}. `;
        
        if (content) {
          if (content.__typename === 'Issue' || content.__typename === 'PullRequest') {
            itemInfo += `${content.title} (#${content.number})**\n`;
            itemInfo += `   - Type: ${content.__typename}\n`;
            itemInfo += `   - State: ${content.state}\n`;
            itemInfo += `   - URL: ${content.url}\n`;
            itemInfo += `   - Item ID: \`${item.id}\`\n`;
            if (content.assignees?.nodes?.length > 0) {
              itemInfo += `   - Assignees: ${content.assignees.nodes.map((a: any) => `@${a.login}`).join(', ')}\n`;
            }
          } else if (content.__typename === 'DraftIssue') {
            itemInfo += `${content.title} (Draft)**\n`;
            itemInfo += `   - Type: Draft Issue\n`;
            itemInfo += `   - Item ID: \`${item.id}\`\n`;
            if (content.body) {
              const bodyPreview = content.body.length > 100 ? content.body.substring(0, 100) + '...' : content.body;
              itemInfo += `   - Body: ${bodyPreview}\n`;
            }
          }
        } else {
          itemInfo += `Unknown Item**\n`;
          itemInfo += `   - Item ID: \`${item.id}\`\n`;
        }
        
        // Add field values
        if (item.fieldValues?.nodes?.length > 0) {
          itemInfo += `   - Fields:\n`;
          item.fieldValues.nodes.forEach((fieldValue: any) => {
            if (fieldValue.field?.name) {
              let value = 'N/A';
              if (fieldValue.text !== undefined) value = fieldValue.text;
              else if (fieldValue.number !== undefined) value = fieldValue.number.toString();
              else if (fieldValue.date !== undefined) value = new Date(fieldValue.date).toLocaleDateString();
              else if (fieldValue.name !== undefined) value = fieldValue.name;
              else if (fieldValue.title !== undefined) value = fieldValue.title;
              
              itemInfo += `     - ${fieldValue.field.name}: ${value}\n`;
            }
          });
        }
        
        return itemInfo;
      }).join('\n');
      
      return {
        content: [
          {
            type: "text",
            text: `Project Items for "${project.title}":\n\n` +
              `Total Items: ${items.length}\n\n` +
              itemDetails +
              `\n\n**Quick Actions:**\n` +
              `- Update status: \`update-item-status\` with itemId and status\n` +
              `- Update any field: \`update-project-item\` with itemId, fieldId, and value`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting project items: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("GitHub Projects MCP server running on stdio");
  }
}

// Run the server
const server = new GitHubProjectsServer();
server.run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
