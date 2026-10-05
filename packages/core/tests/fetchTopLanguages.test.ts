import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTopLanguages } from "../src/fetchers/top-languages.js";

import { approxNumber } from "./utils.js";

vi.mock(import("../src/common/log.js"), async () => {
  const { createLoggerMock } = await import("./utils.js");
  return createLoggerMock();
});

const { logger } = await import("../src/index.js");

const loggerErrorSpy = vi.mocked(logger.error);

const mock = new MockAdapter(axios);

afterEach(() => {
  mock.reset();
  loggerErrorSpy.mockClear();
});

const data_langs = {
  data: {
    user: {
      repositories: {
        nodes: [
          {
            name: "test-repo-1",
            languages: {
              edges: [{ size: 100, node: { color: "#0f0", name: "HTML" } }],
            },
          },
          {
            name: "test-repo-2",
            languages: {
              edges: [
                { size: 100, node: { color: "#0ff", name: "javascript" } },
              ],
            },
          },
          {
            name: "test-repo-3",
            languages: {
              edges: [{ size: 100, node: { color: "#0f0", name: "HTML" } }],
            },
          },
          {
            name: "test-repo-4",
            languages: {
              edges: [
                { size: 100, node: { color: "#0ff", name: "javascript" } },
              ],
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: "cursor-1" },
      },
    },
  },
};

const error = {
  errors: [
    {
      type: "NOT_FOUND",
      path: ["user"],
      locations: [],
      message: "Could not resolve to a User with the login of 'noname'.",
    },
  ],
};

describe("FetchTopLanguages", () => {
  it("should fetch correct language data while using the new calculation", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, data_langs);

    const repo = await fetchTopLanguages("anuraghazra", [], 0.5, 0.5);
    expect(repo).toStrictEqual({
      HTML: {
        color: "#0f0",
        count: 2,
        name: "HTML",
        size: approxNumber(20.0),
      },
      javascript: {
        color: "#0ff",
        count: 2,
        name: "javascript",
        size: approxNumber(20.0),
      },
    });
  });

  it("should fetch correct language data while excluding the 'test-repo-1' repository", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, data_langs);

    const repo = await fetchTopLanguages("anuraghazra", ["test-repo-1"]);
    expect(repo).toStrictEqual({
      HTML: {
        color: "#0f0",
        count: 1,
        name: "HTML",
        size: 100,
      },
      javascript: {
        color: "#0ff",
        count: 2,
        name: "javascript",
        size: 200,
      },
    });
  });

  it("should fetch correct language data while using the old calculation", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, data_langs);

    const repo = await fetchTopLanguages("anuraghazra", [], 1, 0);
    expect(repo).toStrictEqual({
      HTML: {
        color: "#0f0",
        count: 2,
        name: "HTML",
        size: 200,
      },
      javascript: {
        color: "#0ff",
        count: 2,
        name: "javascript",
        size: 200,
      },
    });
  });

  it("should rank languages by the number of repositories they appear in", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, data_langs);

    const repo = await fetchTopLanguages("anuraghazra", [], 0, 1);
    expect(repo).toStrictEqual({
      HTML: {
        color: "#0f0",
        count: 2,
        name: "HTML",
        size: 2,
      },
      javascript: {
        color: "#0ff",
        count: 2,
        name: "javascript",
        size: 2,
      },
    });
  });

  it("should fetch every page of repositories", async () => {
    const repos = data_langs.data.user.repositories.nodes;
    const page = (
      nodes: typeof data_langs.data.user.repositories.nodes,
      hasNextPage: boolean,
      endCursor: string,
    ) => ({
      data: {
        user: { repositories: { nodes, pageInfo: { hasNextPage, endCursor } } },
      },
    });
    mock
      .onPost("https://api.github.com/graphql")
      .replyOnce(200, page(repos.slice(0, 2), true, "cursor-1"))
      .onPost("https://api.github.com/graphql")
      .replyOnce(200, page(repos.slice(2), false, "cursor-2"));

    const repo = await fetchTopLanguages("anuraghazra", [], 0, 1);
    expect(mock.history.post).toHaveLength(2);
    expect(JSON.parse(mock.history.post[1]?.data as string)).toMatchObject({
      variables: { after: "cursor-1" },
    });
    expect(repo).toStrictEqual({
      HTML: { color: "#0f0", count: 2, name: "HTML", size: 2 },
      javascript: { color: "#0ff", count: 2, name: "javascript", size: 2 },
    });
  });

  it("should stop when the cursor does not advance", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, {
      data: {
        user: {
          repositories: {
            nodes: data_langs.data.user.repositories.nodes,
            pageInfo: { hasNextPage: true, endCursor: "same" },
          },
        },
      },
    });

    await fetchTopLanguages("anuraghazra");
    expect(mock.history.post).toHaveLength(2);
  });

  it("should stop after 10 pages", async () => {
    let cursor = 0;
    mock.onPost("https://api.github.com/graphql").reply(() => [
      200,
      {
        data: {
          user: {
            repositories: {
              nodes: data_langs.data.user.repositories.nodes,
              pageInfo: { hasNextPage: true, endCursor: `cursor-${++cursor}` },
            },
          },
        },
      },
    ]);

    await fetchTopLanguages("anuraghazra");
    expect(mock.history.post).toHaveLength(10);
  });

  it("should throw specific error when user not found", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, error);

    await expect(fetchTopLanguages("anuraghazra")).rejects.toThrow(
      "Could not resolve to a User with the login of 'noname'.",
    );

    expect(loggerErrorSpy).toHaveBeenCalledOnce();
  });

  it("should throw other errors with their message", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, {
      errors: [{ message: "Some test GraphQL error" }],
    });

    await expect(fetchTopLanguages("anuraghazra")).rejects.toThrow(
      "Some test GraphQL error",
    );

    expect(loggerErrorSpy).toHaveBeenCalledOnce();
  });

  it("should throw error with specific message when error does not contain message property", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, {
      errors: [{ type: "TEST" }],
    });

    await expect(fetchTopLanguages("anuraghazra")).rejects.toThrow(
      "Something went wrong while trying to retrieve the language data using the GraphQL API.",
    );

    expect(loggerErrorSpy).toHaveBeenCalledOnce();
  });
});
