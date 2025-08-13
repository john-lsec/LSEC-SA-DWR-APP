// netlify/edge-functions/api.js
import { neon } from 'https://deno.land/x/neon@0.3.0/mod.ts';

export default async (request, context) => {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  
  try {
    const sql = neon(Deno.env.get('NETLIFY_DATABASE_URL'));
    
    // Route handling
    switch (path) {
      case 'foremen':
        const foremen = await sql`SELECT id, name FROM foremen WHERE is_active = true ORDER BY name`;
        return new Response(JSON.stringify(foremen), { headers: corsHeaders });
        
      case 'laborers':
        const laborers = await sql`SELECT id, name FROM laborers WHERE is_active = true ORDER BY name`;
        return new Response(JSON.stringify(laborers), { headers: corsHeaders });
        
      case 'projects':
        const projects = await sql`SELECT id, name FROM projects WHERE is_active = true ORDER BY name`;
        return new Response(JSON.stringify(projects), { headers: corsHeaders });
        
      case 'equipment':
        const type = url.searchParams.get('type');
        if (!type) {
          return new Response(JSON.stringify({ error: 'Type required' }), { status: 400, headers: corsHeaders });
        }
        const equipment = await sql`SELECT id, name FROM equipment WHERE equipment_type = ${type} AND is_active = true ORDER BY name`;
        return new Response(JSON.stringify(equipment), { headers: corsHeaders });
        
      case 'project-items':
        const projectId = url.searchParams.get('project_id');
        if (!projectId) {
          return new Response(JSON.stringify({ error: 'Project ID required' }), { status: 400, headers: corsHeaders });
        }
        const items = await sql`SELECT item_name, unit FROM project_items WHERE project_id = ${projectId} AND is_active = true ORDER BY item_name`;
        return new Response(JSON.stringify(items), { headers: corsHeaders });
        
      case 'submit-dwr':
        if (request.method !== 'POST') {
          return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: corsHeaders });
        }
        
        const data = await request.json();
        const {
          work_date, foreman_id, project_id, arrival_time, departure_time,
          truck_id, trailer_id, billable_work, maybe_explanation, per_diem,
          laborers, machines, items
        } = data;
        
        // Insert main DWR
        const [dwr] = await sql`
          INSERT INTO daily_work_reports (
            work_date, foreman_id, project_id, arrival_time, departure_time,
            truck_id, trailer_id, billable_work, maybe_explanation, per_diem
          ) VALUES (
            ${work_date}, ${foreman_id}, ${project_id}, ${arrival_time}, ${departure_time},
            ${truck_id || null}, ${trailer_id || null}, ${billable_work}, 
            ${maybe_explanation || null}, ${per_diem}
          ) RETURNING id
        `;
        
        const dwrId = dwr.id;
        
        // Insert crew members
        if (laborers?.length) {
          for (const laborerId of laborers) {
            await sql`INSERT INTO dwr_crew_members (dwr_id, laborer_id) VALUES (${dwrId}, ${laborerId})`;
          }
        }
        
        // Insert machines
        if (machines?.length) {
          for (const machineId of machines) {
            await sql`INSERT INTO dwr_machines (dwr_id, machine_id) VALUES (${dwrId}, ${machineId})`;
          }
        }
        
        // Insert items
        if (items?.length) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await sql`
              INSERT INTO dwr_items (
                dwr_id, item_name, quantity, unit, location_description,
                latitude, longitude, duration_hours, notes, item_index
              ) VALUES (
                ${dwrId}, ${item.item_name}, ${item.quantity}, ${item.unit},
                ${item.location_description}, ${item.latitude || null}, 
                ${item.longitude || null}, ${item.duration_hours}, 
                ${item.notes || null}, ${i + 1}
              )
            `;
          }
        }
        
        return new Response(JSON.stringify({ 
          success: true, 
          id: dwrId, 
          message: 'DWR submitted successfully' 
        }), { headers: corsHeaders });
        
      default:
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
    }
    
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
};

export const config = {
  path: "/api/*"
};