import { FunctionHandler } from "./types";
import axios from "axios";
import { traceableFunction } from "./tracing";

const functions: FunctionHandler[] = [];


// Add PII detection function
functions.push({
  schema: {
    name: "handle_pii_statement",
    type: "function",
    description: "Handle user statements that contain personally identifiable information (PII) such as names, addresses, phone numbers, email addresses, ID numbers, or other personal details. Use this when the user makes a statement (not a question) that includes personal information.",
    parameters: {
      type: "object",
      properties: {
        statement: {
          type: "string",
          description: "The user's statement that contains PII"
        },
      },
      required: ["statement"],
    },
  },
  handler: traceableFunction(
    async (args: { statement: string }) => {
      console.log(`[PII_HANDLER] Input detected: ${JSON.stringify(args)}`);
      const output = {
        message: "I notice you've shared personal information. For your privacy and security, please avoid sharing personally identifiable information (PII) such as names, addresses, phone numbers, email addresses, or ID numbers in our conversation. I'm here to help with general information about city services and procedures without needing your personal details."
      };
      console.log(`[PII_HANDLER] Output: ${JSON.stringify(output)}`);
      return JSON.stringify(output);
    },
    {
      name: "pii_handler",
      metadata: {
        type: "privacy",
        description: "Handles statements containing personally identifiable information",
        inputs: ["statement: string"],
        outputs: ["message: string"]
      }
    }
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
  handler: traceableFunction(
    async (args: { query: string; max_results?: number }) => {
      console.log(`[TAVILY_SEARCH] Input: ${JSON.stringify(args)}`);
      try {
        // You'll need to add your Tavily API key to the .env file
        const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
        if (!TAVILY_API_KEY) {
          const errorOutput = { error: "Tavily API key not configured" };
          console.log(`[TAVILY_SEARCH] Output (Error): ${JSON.stringify(errorOutput)}`);
          return JSON.stringify(errorOutput);
        }

        const search_params = {
          api_key: TAVILY_API_KEY,
          query: args.query,
          search_depth: "advanced",
          max_results: 20,
          include_answer: false,
        };

        const response = await axios.post('https://api.tavily.com/search', search_params);

        const output = {
          answer: response.data.answer,
          results: response.data.results
        };
        console.log(`[TAVILY_SEARCH] Output: ${JSON.stringify(output)}`);
        return JSON.stringify(output);
      } catch (error) {
        console.error("Tavily search error:", error);
        const errorOutput = { error: "Search failed" };
        console.log(`[TAVILY_SEARCH] Output (Error): ${JSON.stringify(errorOutput)}`);
        return JSON.stringify(errorOutput);
      }
    },
    {
      name: "tavily_search",
      metadata: {
        type: "search",
        description: "Searches for current information using Tavily API",
        inputs: ["query: string", "max_results?: number"],
        outputs: ["answer: string", "results: array"]
      }
    }
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
  handler: traceableFunction(
    async (args: { latitude: number; longitude: number }) => {
      console.log(`[GET_WEATHER] Input: ${JSON.stringify(args)}`);
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m`
        );
        const data = await response.json();
        const currentTemp = data.current?.temperature_2m;
        const output = { temp: currentTemp };
        console.log(`[GET_WEATHER] Output: ${JSON.stringify(output)}`);
        return JSON.stringify(output);
      } catch (error) {
        console.error("Weather fetch error:", error);
        const errorOutput = { error: "Failed to fetch weather" };
        console.log(`[GET_WEATHER] Output (Error): ${JSON.stringify(errorOutput)}`);
        return JSON.stringify(errorOutput);
      }
    },
    {
      name: "get_weather",
      metadata: {
        type: "weather",
        description: "Fetches current weather data from coordinates",
        inputs: ["latitude: number", "longitude: number"],
        outputs: ["temp: number (celsius)"]
      }
    }
  ),
});

export default functions;
