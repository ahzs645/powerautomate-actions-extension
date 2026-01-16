// SolutionAnalyzer - Analyzes Power Automate solution packages (.zip)
// Extracts and aggregates analysis across multiple flows

import JSZip from 'jszip';
import { FlowAnalyzer, FlowAnalysisResult } from './FlowAnalyzer';
import { ExceptionAnalyzer, ExceptionAnalysisResult } from './ExceptionAnalyzer';

export interface SolutionFlow {
  name: string;
  displayName: string;
  filename: string;
  definition: any;
  analysis: FlowAnalysisResult | null;
  exceptionAnalysis: ExceptionAnalysisResult | null;
}

export interface SolutionConnection {
  name: string;
  displayName: string;
  connectorId: string;
  isCustomizable: boolean;
}

export interface SolutionEnvironmentVariable {
  name: string;
  displayName: string;
  type: string;
  isCustomizable: boolean;
  defaultValue?: string;
}

export interface SolutionDependency {
  name: string;
  displayName: string;
  type: string;
  dependentComponent: string;
  schemaName?: string;          // Solution component schema name
  requiredType?: string;        // Type code (29 = workflow, etc.)
  solution?: string;            // Required solution if known
}

// Flow dependency tracking for solution-level diagram
export interface FlowDependency {
  sourceFlowName: string;
  targetFlowName: string;
  targetFlowId: string;
  actionName: string;  // The Workflow action that makes the call
  isInternal: boolean; // true if target flow is in the solution
}

export interface FlowDependencyGraph {
  nodes: Array<{
    id: string;
    name: string;
    displayName: string;
    actionCount: number;
    complexity: number;
    rating: number;
    isInSolution: boolean;
  }>;
  edges: FlowDependency[];
  missingFlows: string[]; // IDs of referenced flows not in solution
}

// Missing child flow detection
export interface MissingChildFlow {
  flowId: string;
  flowDisplayName?: string;
  referencedBy: string[];       // Flow names that reference this
  actionNames: string[];        // Specific action names making the call
}

export interface EnhancedMissingDependencies {
  solutionDependencies: SolutionDependency[];  // From solution.xml
  missingChildFlows: MissingChildFlow[];        // From flow analysis
  totalMissing: number;
}

export interface SolutionAnalysisResult {
  name: string;
  version: string;
  publisher: string;
  flows: SolutionFlow[];
  connections: SolutionConnection[];
  environmentVariables: SolutionEnvironmentVariable[];
  missingDependencies: SolutionDependency[];
  aggregateMetrics: {
    totalFlows: number;
    totalActions: number;
    totalVariables: number;
    totalConnections: number;
    averageComplexity: number;
    averageRating: number;
    flowsWithIssues: number;
  };
}

export class SolutionAnalyzer {
  private flowAnalyzer: FlowAnalyzer;
  private exceptionAnalyzer: ExceptionAnalyzer;

  constructor() {
    this.flowAnalyzer = new FlowAnalyzer();
    this.exceptionAnalyzer = new ExceptionAnalyzer();
  }

  /**
   * Analyze a solution ZIP file
   */
  async analyzeSolution(file: File): Promise<SolutionAnalysisResult> {
    const zip = await JSZip.loadAsync(file);

    // Extract solution metadata
    const solutionXml = await this.extractSolutionXml(zip);
    const customizationsXml = await this.extractCustomizationsXml(zip);

    // Parse solution info
    const solutionInfo = this.parseSolutionInfo(solutionXml);

    // Extract flows
    const flows = await this.extractFlows(zip);

    // Parse customizations for connections, environment variables
    const connections = this.parseConnections(customizationsXml);
    const environmentVariables = this.parseEnvironmentVariables(customizationsXml);
    const missingDependencies = this.parseMissingDependencies(solutionXml);

    // Calculate aggregate metrics
    const aggregateMetrics = this.calculateAggregateMetrics(flows);

    return {
      name: solutionInfo.name,
      version: solutionInfo.version,
      publisher: solutionInfo.publisher,
      flows,
      connections,
      environmentVariables,
      missingDependencies,
      aggregateMetrics,
    };
  }

  /**
   * Extract solution.xml from ZIP
   */
  private async extractSolutionXml(zip: JSZip): Promise<string> {
    const solutionFile = zip.file('solution.xml');
    if (solutionFile) {
      return await solutionFile.async('text');
    }
    return '';
  }

  /**
   * Extract customizations.xml from ZIP
   */
  private async extractCustomizationsXml(zip: JSZip): Promise<string> {
    const customizationsFile = zip.file('customizations.xml');
    if (customizationsFile) {
      return await customizationsFile.async('text');
    }
    return '';
  }

  /**
   * Extract and analyze all flows from the solution
   */
  private async extractFlows(zip: JSZip): Promise<SolutionFlow[]> {
    const flows: SolutionFlow[] = [];

    // Find workflow files
    const workflowFiles: string[] = [];
    zip.forEach((relativePath, file) => {
      // Look for workflow definition files
      if (
        (relativePath.includes('Workflows/') && relativePath.endsWith('.json')) ||
        relativePath.endsWith('definition.json')
      ) {
        workflowFiles.push(relativePath);
      }
    });

    // Process each workflow
    for (const filepath of workflowFiles) {
      try {
        const file = zip.file(filepath);
        if (file) {
          const content = await file.async('text');
          const definition = JSON.parse(content);

          // Extract name from path
          const filename = filepath.split('/').pop() || filepath;
          const name = filename.replace('.json', '').replace(/[{}\-]/g, '');

          // Analyze the flow
          let analysis: FlowAnalysisResult | null = null;
          let exceptionAnalysis: ExceptionAnalysisResult | null = null;

          try {
            analysis = this.flowAnalyzer.analyze(definition, name);
            exceptionAnalysis = this.exceptionAnalyzer.analyze(analysis);
          } catch (error) {
            console.error(`Error analyzing flow ${name}:`, error);
          }

          flows.push({
            name,
            displayName: definition.properties?.displayName || name,
            filename: filepath,
            definition,
            analysis,
            exceptionAnalysis,
          });
        }
      } catch (error) {
        console.error(`Error processing ${filepath}:`, error);
      }
    }

    return flows;
  }

  /**
   * Parse solution info from solution.xml
   */
  private parseSolutionInfo(xml: string): { name: string; version: string; publisher: string } {
    const result = {
      name: 'Unknown Solution',
      version: '1.0.0',
      publisher: 'Unknown',
    };

    if (!xml) return result;

    // Simple XML parsing (could use a proper XML parser for production)
    const uniqueNameMatch = xml.match(/<UniqueName>(.*?)<\/UniqueName>/);
    if (uniqueNameMatch) result.name = uniqueNameMatch[1];

    const versionMatch = xml.match(/<Version>(.*?)<\/Version>/);
    if (versionMatch) result.version = versionMatch[1];

    const publisherMatch = xml.match(/<Publisher>[\s\S]*?<UniqueName>(.*?)<\/UniqueName>/);
    if (publisherMatch) result.publisher = publisherMatch[1];

    return result;
  }

  /**
   * Parse connection references from customizations.xml
   */
  private parseConnections(xml: string): SolutionConnection[] {
    const connections: SolutionConnection[] = [];

    if (!xml) return connections;

    // Find connection reference entries
    const connectionMatches = Array.from(
      xml.matchAll(/<connectionreference[^>]*>([\s\S]*?)<\/connectionreference>/gi)
    );

    for (const match of connectionMatches) {
      const content = match[1];

      const nameMatch = content.match(/connectionreferencelogicalname="([^"]*)"/) ||
        content.match(/<connectionreferencelogicalname>(.*?)<\/connectionreferencelogicalname>/i);
      const displayMatch = content.match(/connectionreferencedisplayname="([^"]*)"/) ||
        content.match(/<connectionreferencedisplayname>(.*?)<\/connectionreferencedisplayname>/i);
      const connectorMatch = content.match(/connectorid="([^"]*)"/) ||
        content.match(/<connectorid>(.*?)<\/connectorid>/i);
      const customizableMatch = content.match(/iscustomizable="(\d)"/) ||
        content.match(/<iscustomizable>(\d)<\/iscustomizable>/i);

      if (nameMatch) {
        connections.push({
          name: nameMatch[1],
          displayName: displayMatch?.[1] || nameMatch[1],
          connectorId: connectorMatch?.[1] || '',
          isCustomizable: customizableMatch?.[1] === '1',
        });
      }
    }

    return connections;
  }

  /**
   * Parse environment variables from customizations.xml
   */
  private parseEnvironmentVariables(xml: string): SolutionEnvironmentVariable[] {
    const variables: SolutionEnvironmentVariable[] = [];

    if (!xml) return variables;

    // Find environment variable definitions
    const varMatches = Array.from(
      xml.matchAll(/<environmentvariabledefinition[^>]*>([\s\S]*?)<\/environmentvariabledefinition>/gi)
    );

    for (const match of varMatches) {
      const content = match[1];

      const nameMatch = content.match(/schemaname="([^"]*)"/) ||
        content.match(/<schemaname>(.*?)<\/schemaname>/i);
      const displayMatch = content.match(/<displayname>(.*?)<\/displayname>/i);
      const typeMatch = content.match(/<type>(.*?)<\/type>/i);
      const customizableMatch = content.match(/iscustomizable="(\d)"/) ||
        content.match(/<iscustomizable>(\d)<\/iscustomizable>/i);
      const defaultMatch = content.match(/<defaultvalue>(.*?)<\/defaultvalue>/i);

      if (nameMatch) {
        variables.push({
          name: nameMatch[1],
          displayName: displayMatch?.[1] || nameMatch[1],
          type: typeMatch?.[1] || 'Unknown',
          isCustomizable: customizableMatch?.[1] === '1',
          defaultValue: defaultMatch?.[1],
        });
      }
    }

    return variables;
  }

  /**
   * Parse missing dependencies from solution.xml
   */
  private parseMissingDependencies(xml: string): SolutionDependency[] {
    const dependencies: SolutionDependency[] = [];

    if (!xml) return dependencies;

    // Find missing dependency entries
    const depMatches = Array.from(
      xml.matchAll(/<MissingDependency>([\s\S]*?)<\/MissingDependency>/gi)
    );

    for (const match of depMatches) {
      const content = match[1];

      const requiredMatch = content.match(/<Required[^>]*>([\s\S]*?)<\/Required>/i);
      const dependentMatch = content.match(/<Dependent[^>]*>([\s\S]*?)<\/Dependent>/i);

      if (requiredMatch) {
        const required = requiredMatch[1];
        const nameMatch = required.match(/displayName="([^"]*)"/) ||
          required.match(/<displayName>(.*?)<\/displayName>/i);
        const typeMatch = required.match(/type="([^"]*)"/) ||
          required.match(/<type>(.*?)<\/type>/i);

        const dependent = dependentMatch?.[1] || '';
        const depNameMatch = dependent.match(/displayName="([^"]*)"/) ||
          dependent.match(/<displayName>(.*?)<\/displayName>/i);

        if (nameMatch) {
          dependencies.push({
            name: nameMatch[1],
            displayName: nameMatch[1],
            type: typeMatch?.[1] || 'Unknown',
            dependentComponent: depNameMatch?.[1] || 'Unknown',
          });
        }
      }
    }

    return dependencies;
  }

  /**
   * Calculate aggregate metrics across all flows
   */
  private calculateAggregateMetrics(flows: SolutionFlow[]): SolutionAnalysisResult['aggregateMetrics'] {
    const analyzedFlows = flows.filter((f) => f.analysis !== null);

    if (analyzedFlows.length === 0) {
      return {
        totalFlows: flows.length,
        totalActions: 0,
        totalVariables: 0,
        totalConnections: 0,
        averageComplexity: 0,
        averageRating: 0,
        flowsWithIssues: 0,
      };
    }

    const totalActions = analyzedFlows.reduce((sum, f) => sum + (f.analysis?.actionCount || 0), 0);
    const totalVariables = analyzedFlows.reduce((sum, f) => sum + (f.analysis?.variableCount || 0), 0);
    const totalConnections = new Set(
      analyzedFlows.flatMap((f) => f.analysis?.connections.map((c) => c.conName) || [])
    ).size;
    const totalComplexity = analyzedFlows.reduce((sum, f) => sum + (f.analysis?.complexity || 0), 0);
    const totalRating = analyzedFlows.reduce((sum, f) => sum + (f.analysis?.overallRating || 0), 0);
    const flowsWithIssues = analyzedFlows.filter(
      (f) => (f.exceptionAnalysis?.issues.filter((i) => i.level === 'fail').length || 0) > 0
    ).length;

    return {
      totalFlows: flows.length,
      totalActions,
      totalVariables,
      totalConnections,
      averageComplexity: Math.round(totalComplexity / analyzedFlows.length),
      averageRating: Math.round(totalRating / analyzedFlows.length),
      flowsWithIssues,
    };
  }

  // ============================================================================
  // FLOW DEPENDENCY EXTRACTION (for solution-level diagram)
  // ============================================================================

  /**
   * Extract flow dependencies from a solution - identifies which flows call other flows
   */
  public extractFlowDependencies(flows: SolutionFlow[]): FlowDependencyGraph {
    const nodes: FlowDependencyGraph['nodes'] = [];
    const edges: FlowDependency[] = [];
    const flowIdMap = new Map<string, SolutionFlow>();
    const flowNameMap = new Map<string, SolutionFlow>();

    // Build flow lookup maps
    flows.forEach(flow => {
      // Try to get flow ID from definition
      const flowId = flow.definition?.name ||
                     flow.definition?.properties?.workflowId ||
                     flow.name;
      flowIdMap.set(flowId.toLowerCase(), flow);
      flowNameMap.set(flow.name.toLowerCase(), flow);

      nodes.push({
        id: flow.name,
        name: flow.name,
        displayName: flow.displayName,
        actionCount: flow.analysis?.actionCount || 0,
        complexity: flow.analysis?.complexity || 0,
        rating: flow.analysis?.overallRating || 0,
        isInSolution: true,
      });
    });

    // Find Workflow actions in each flow
    const referencedFlowIds = new Set<string>();

    flows.forEach(flow => {
      if (!flow.analysis?.actions) return;

      flow.analysis.actions.forEach(action => {
        if (action.Type === 'Workflow' && action.object) {
          try {
            const actionObj = JSON.parse(action.object);
            // Try different paths to find child flow reference
            const workflowRef = actionObj.inputs?.host?.workflow?.id ||
                               actionObj.inputs?.host?.workflowReferenceName ||
                               actionObj.inputs?.workflow?.id ||
                               actionObj.inputs?.workflowId;

            if (workflowRef) {
              const refLower = workflowRef.toLowerCase();
              referencedFlowIds.add(refLower);

              // Check if target flow is in solution
              const targetFlow = flowIdMap.get(refLower) || flowNameMap.get(refLower);

              edges.push({
                sourceFlowName: flow.name,
                targetFlowName: targetFlow?.name || workflowRef,
                targetFlowId: workflowRef,
                actionName: action.Name,
                isInternal: !!targetFlow,
              });
            }
          } catch (error) {
            console.error(`Error parsing Workflow action ${action.Name}:`, error);
          }
        }
      });
    });

    // Find missing flows (referenced but not in solution)
    const missingFlows: string[] = [];
    referencedFlowIds.forEach(id => {
      if (!flowIdMap.has(id) && !flowNameMap.has(id)) {
        missingFlows.push(id);

        // Add external flow node
        nodes.push({
          id,
          name: id,
          displayName: `External: ${id.substring(0, 20)}${id.length > 20 ? '...' : ''}`,
          actionCount: 0,
          complexity: 0,
          rating: 0,
          isInSolution: false,
        });
      }
    });

    return { nodes, edges, missingFlows };
  }

  /**
   * Detect child flows that are referenced but not included in the solution
   */
  public detectMissingChildFlows(flows: SolutionFlow[]): MissingChildFlow[] {
    const dependencyGraph = this.extractFlowDependencies(flows);
    const missingFlows: Map<string, MissingChildFlow> = new Map();

    dependencyGraph.edges.forEach(edge => {
      if (!edge.isInternal) {
        const existing = missingFlows.get(edge.targetFlowId);
        if (existing) {
          if (!existing.referencedBy.includes(edge.sourceFlowName)) {
            existing.referencedBy.push(edge.sourceFlowName);
          }
          if (!existing.actionNames.includes(edge.actionName)) {
            existing.actionNames.push(edge.actionName);
          }
        } else {
          missingFlows.set(edge.targetFlowId, {
            flowId: edge.targetFlowId,
            flowDisplayName: edge.targetFlowName,
            referencedBy: [edge.sourceFlowName],
            actionNames: [edge.actionName],
          });
        }
      }
    });

    return Array.from(missingFlows.values());
  }

  /**
   * Get combined missing dependencies (solution.xml + child flow analysis)
   */
  public getEnhancedMissingDependencies(
    solutionXml: string,
    flows: SolutionFlow[]
  ): EnhancedMissingDependencies {
    const solutionDependencies = this.parseMissingDependencies(solutionXml);
    const missingChildFlows = this.detectMissingChildFlows(flows);

    return {
      solutionDependencies,
      missingChildFlows,
      totalMissing: solutionDependencies.length + missingChildFlows.length,
    };
  }

  /**
   * Convert dependency type code to readable name
   */
  public getReadableDependencyType(typeCode: string | undefined): string {
    const typeMap: Record<string, string> = {
      '1': 'Entity',
      '2': 'Attribute',
      '9': 'Option Set',
      '10': 'Relationship',
      '29': 'Workflow',
      '60': 'Web Resource',
      '61': 'Site Map',
      '62': 'Role',
      '63': 'Privilege',
      '65': 'Plug-in Type',
      '66': 'Plug-in Assembly',
      '91': 'Managed Property',
      '92': 'Connection Role',
    };
    return typeMap[typeCode || ''] || typeCode || 'Unknown';
  }
}

export default SolutionAnalyzer;
