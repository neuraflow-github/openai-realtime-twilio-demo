import { FunctionHandler } from "./types";
import axios from "axios";
import { traceable } from "./tracing";

const functions: FunctionHandler[] = [];

// Add the simple add function from your original tools
functions.push({
  schema: {
    name: "add",
    type: "function",
    description: "Add two numbers. Please let the user know that you're adding the numbers BEFORE you call the tool",
    parameters: {
      type: "object",
      properties: {
        a: {
          type: "number",
          description: "First number to add"
        },
        b: {
          type: "number",
          description: "Second number to add"
        },
      },
      required: ["a", "b"],
    },
  },
  handler: traceable(
    async (args: { a: number; b: number }) => {
      return JSON.stringify({ result: args.a + args.b });
    },
    { name: "add_function", metadata: { type: "math" } }
  ),
});

// Add Tavily search function
functions.push({
  schema: {
    name: "tavily_search",
    type: "function",
    description: "Search for current information about Siegburg city services, events, procedures, and municipal information. MANDATORY USAGE: You MUST use this tool BEFORE providing ANY specific information about: dog registration, permits, licenses, office locations, opening hours, fees, required documents, procedures, or any other municipal services. NEVER answer from memory - ALWAYS search first for factual questions about city services.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query in German or the user's language. Examples: 'Hund anmelden Siegburg', 'Hundesteuer Siegburg Anmeldung', 'Bürgerbüro Öffnungszeiten Siegburg'"
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return",
          default: 5
        },
      },
      required: ["query"],
    },
  },
  handler: traceable(
    async (args: { query: string; max_results?: number }) => {
      try {
        // You'll need to add your Tavily API key to the .env file
        const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
        if (!TAVILY_API_KEY) {
          return JSON.stringify({ error: "Tavily API key not configured" });
        }

        const response = await axios.post('https://api.tavily.com/search', {
          api_key: TAVILY_API_KEY,
          query: args.query,
          max_results: args.max_results || 5,
          include_answer: true,
        });

        return JSON.stringify({
          answer: response.data.answer,
          results: response.data.results
        });
      } catch (error) {
        console.error("Tavily search error:", error);
        return JSON.stringify({ error: "Search failed" });
      }
    },
    { name: "tavily_search", metadata: { type: "search" } }
  ),
});

// Keep the weather function as an example
functions.push({
  schema: {
    name: "get_weather_from_coords",
    type: "function",
    description: "Get the current weather",
    parameters: {
      type: "object",
      properties: {
        latitude: {
          type: "number",
        },
        longitude: {
          type: "number",
        },
      },
      required: ["latitude", "longitude"],
    },
  },
  handler: traceable(
    async (args: { latitude: number; longitude: number }) => {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m`
      );
      const data = await response.json();
      const currentTemp = data.current?.temperature_2m;
      return JSON.stringify({ temp: currentTemp });
    },
    { name: "get_weather", metadata: { type: "weather" } }
  ),
});

export default functions;
