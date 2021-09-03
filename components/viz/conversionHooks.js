import { useEffect, useRef } from 'react'
import Graph from 'graph-data-structure'
import { useDispatch, useSelector, useStore } from "react-redux"
import { co2PageUpdateQuery, getFullFuelType, getPreferredGrades, sumOfCO2 } from "components/CO2Forecast/calculate"
import { useApolloClient } from "@apollo/client"
import { GQL_countryCurrentProduction } from "queries/country"
import { notification } from "antd"
import settings from "../../settings"
import { useRouter } from "next/router"

const DEBUG = false

let fuelTypes = [ ...settings.supportedFuels ] // Start with generic types, is extended later from DB data.

let lastConversionPath = []
let lastConversionLoggedTimer

// One graph per fully qualified fuel type contains the possible conversion paths for that fuel.
const graphs = {}
// The corresponding conversion factors are in the conversions object.
const conversions = {}

const _toUnit = c => c.toUnit + ( ( c.modifier?.length > 0 ) ? settings.fuelTypeSeparator + c.modifier : '' )
let __graph // For debug output in catch scope

export const useConversionHooks = () => {
	const conversionConstants = useSelector( redux => redux.conversions )
	const allSources = useSelector( redux => redux.allSources )
	const gwp = useSelector( redux => redux.gwp )
	const country = useSelector( redux => redux.country )
	const stableProduction = useSelector( redux => redux.stableProduction )
	const apolloClient = useApolloClient()
	const router = useRouter()
	const store = useStore()
	const dispatch = useDispatch()
	const query = useRef( {} )

	// Parse query from URL - this avoids delay in query params by next js router
	useEffect( () => {
		const urlQuery = new URLSearchParams( router.asPath.split( '?' )[ 1 ] )
		Array.from( urlQuery.entries() ).forEach( ( [ key, value ] ) => {
			query.current[ key ] = value
		} )
	}, [ router.asPath ] )

	// Build unit graphs for all fuels.

	useEffect( () => {
		if( !( conversionConstants?.length > 0 ) ) return

		conversionConstants.forEach( c => {
			const fullFuelType = getFullFuelType( c )
			// Extend fuelTypes with this full type?
			if( !( c.fossilFuelType?.length > 0 ) || fuelTypes.includes( fullFuelType ) ) return
			fuelTypes.push( fullFuelType )
		} )
		DEBUG && console.log( fuelTypes )

		// Build one Graph() per fuel type
		fuelTypes.forEach( fuelType => {

			graphs[ fuelType ] = Graph()
			conversions[ fuelType ] = {}
			const thisFuelConversions = conversionConstants.filter( c => c.fullFuelType === fuelType || c.fossilFuelType === null )

			// Add all unique units as nodes
			const allUnits = {}
			thisFuelConversions.forEach( u => {
				allUnits[ u.fromUnit ] = true
				allUnits[ _toUnit( u ) ] = true
			} )
			Object.keys( allUnits ).forEach( u => graphs[ fuelType ].addNode( u ) )

			DEBUG && console.log( { fuelType, allUnits, thisFuelConversions } )

			thisFuelConversions.forEach( conv => {
				graphs[ fuelType ].addEdge( conv.fromUnit, _toUnit( conv ) )
				conversions[ fuelType ][ conv.fromUnit + '>' + _toUnit( conv ) ] = {
					factor: conv.factor,
					low: conv.low,
					high: conv.high,
					modifier: conv.modifier
				}
			} )
		} )
	}, [ conversionConstants?.length ] )

	const conversionPathLoggerReset = () => lastConversionPath = {}

	const pageQuery = () => {
		return { ...query.current, ...router.query }
	}

	const goToCountryOverview = async() => {
		dispatch( { type: 'REGION', payload: undefined } )
		dispatch( { type: 'PROJECT', payload: undefined } )
		dispatch( { type: 'PRODUCTIONSOURCEID', payload: undefined } )
		dispatch( { type: 'RESERVESSOURCEID', payload: undefined } )
		dispatch( { type: 'PROJECTIONSOURCEID', payload: undefined } )
		dispatch( { type: 'STABLEPRODUCTION', payload: undefined } )
		await co2PageUpdateQuery( store, router )
	}

	const convertVolume = ( { volume, unit, fossilFuelType }, toUnit ) => {
		try {
			const graph = graphs[ fossilFuelType ]
			__graph = graph
			const conversion = conversions[ fossilFuelType ]

			const path = graph.shortestPath( unit, toUnit )

			let factor = 1

			for( let step = 1; step < path.length; step++ ) {
				const from = path[ step - 1 ]
				const to = path[ step ]
				const conv = conversion[ from + '>' + to ]

				if( !conv ) throw new Error(
					`Conversion data issue: From ${ from } to ${ to } for ${ fossilFuelType } is ${ JSON.stringify( conv ) }` )

				factor *= conv.factor
			}
			return factor * volume
		} catch( e ) {
			console.log( e.message + ': ' + unit, fossilFuelType, toUnit )
			console.log( { graph: __graph.serialize() } )
			return volume
		}
	}

	const _co2Factors = ( unit, toUnit, fullFuelType ) => {
		const graph = graphs[ fullFuelType ]
		const conversion = conversions[ fullFuelType ]
		if( !graph ) throw new Error( 'No conversion graph for ' + fullFuelType )
		if( !conversion ) throw new Error( 'No conversion factors for ' + fullFuelType )

		const path = graph.shortestPath( unit, toUnit )
		let pathAsString = unit + ' > '
		DEBUG && console.log( 'Path ', { unit, toUnit, path, conversion } )

		let factor = 1, low = 1, high = 1
		for( let step = 1; step < path.length; step++ ) {
			const from = path[ step - 1 ]
			const to = path[ step ]
			const conv = conversion[ from + '>' + to ]

			if( !conv ) throw new Error(
				`Conversion data issue: From ${ from } to ${ to } for ${ fullFuelType } is ${ JSON.stringify( conv ) }` )
			const { factor: stepFactor, low: stepLow, high: stepHigh } = conv

			factor *= stepFactor
			low *= stepLow ?? stepFactor
			high *= stepHigh ?? stepFactor
			pathAsString += to + ' > '
		}
		const logString = '[' + fullFuelType + '] ' + pathAsString.substring( 0, pathAsString.length - 3 )
		if( !lastConversionPath.includes( logString ) ) lastConversionPath.push( logString )

		if( lastConversionLoggedTimer ) clearTimeout( lastConversionLoggedTimer )
		lastConversionLoggedTimer = setTimeout( () => {
			console.log( '----- Conversions logged -----' )
			lastConversionPath.sort( ( a, b ) => a.localeCompare( b ) ).forEach( p => console.log( p ) )
			lastConversionPath = []
		}, 1000 )
		return { low, high, factor }
	}

	const co2FromVolume = ( { volume, unit, fossilFuelType, subtype, methaneM3Ton }, log ) => {
		const fullFuelType = getFullFuelType( { fossilFuelType, subtype } )
		const graph = graphs[ fullFuelType ]
		if( !graph ) return { low: 0, high: 0, factor: 0 }

		let scope1 = {}, scope3
		const toScope1Unit = 'kgco2e' + settings.fuelTypeSeparator + gwp

		try {
			scope1 = _co2Factors( unit, toScope1Unit, fullFuelType )
		} catch( e ) {
			DEBUG && console.log( `Scope 1 ${ toScope1Unit } Conversion Error:  ${ e.message }`, {
				unit, toUnit: toScope1Unit,
				fullFuelType,
				graph: graph.serialize()
			} )
		}

		try {
			scope3 = _co2Factors( unit, 'kgco2e', fullFuelType )
		} catch( e ) {
			if( console.trace ) console.trace()
			console.log( 'Conversion to kgco2e Error: ' + e.message, { unit, fullFuelType, graph: graph.serialize() } )
			throw new Error( "While looking for " + fullFuelType + ' ' + unit + " -> kgco2e conversion:\n" + e.message )
		}

		DEBUG && console.log( 'CO2 Factors: ', { scope1, scope3, methaneM3Ton } )

		let volume1 = volume
		if( methaneM3Ton > 0 ) {
			// Calculate Scope1 for sparse project from production volume
			const e6ProductionTons = convertVolume( { volume, unit, fossilFuelType }, 'e6ton' )
			const e6m3Methane = e6ProductionTons * methaneM3Ton
			const e3tonMethane = convertVolume( {
				volume: e6m3Methane,
				unit: 'e6m3',
				fossilFuelType
			}, 'e3ton|sparse-scope1' )
			volume1 = e3tonMethane

			// Get new factors for gas
			try {
				scope1 = _co2Factors( 'e3ton', toUnit, 'gas' )
			} catch( e ) {
				console.log( `Scope 1 ${ toUnit } Project gas equiv conversion error:  ${ e.message }`, {
					unit, toUnit, graphs,
					graph: graph.serialize()
				} )
			}

			console.log( 'Project Specific Scope1:', {
				scope1,
				volume,
				e6ProductionTons,
				e6m3Methane,
				methaneM3Ton,
				e3tonMethane,
				volume1,
				kgco2e: volume1 * scope1.factor
			} )
		}

		const result = {
			scope1: [ volume1 * ( scope1.low || 0 ) / 1e9, volume1 * ( scope1.factor || 0 ) / 1e9, volume1 * ( scope1.high || 0 ) / 1e9 ],
			scope3: [ volume * scope3.low / 1e9, volume * scope3.factor / 1e9, volume * scope3.high / 1e9 ]
		}

		DEBUG && console.log( '.....co2', { result, scope1, volume1 } )
		return result
	}

	const reservesProduction =
		( projection, reserves, projectionSourceId, reservesSourceId, limits, grades ) => {
			DEBUG && console.log( 'reservesProduction', {
				projection,
				reserves,
				projectionSourceId,
				reservesSourceId,
				limits,
				grades
			} )
			if( !projectionSourceId ) return []
			if( !( projection?.length > 1 ) ) return []
			if( !limits?.production ) return []
			if( !limits?.projection ) return []

			// Find most recent preferred reserve

			const useGrades = getPreferredGrades( reserves, reservesSourceId )

			const lastReserves = {
				oil: { p: { year: 0, value: 0 }, c: { year: 0, value: 0 } },
				gas: { p: { year: 0, value: 0 }, c: { year: 0, value: 0 } }
			}
			for( let i = reserves.length - 1; i >= 0; i-- ) { // Scan in reverse to find latest.
				const r = reserves[ i ]
				if( r.sourceId !== reservesSourceId ) continue
				if( r.grade !== useGrades.pGrade && r.grade !== useGrades.cGrade ) continue
				const grade = r.grade[ 1 ] // Disregard first character.
				if( r.year < lastReserves[ r.fossilFuelType ][ grade ].year ) continue
				lastReserves[ r.fossilFuelType ][ grade ].year = r.year
				lastReserves[ r.fossilFuelType ][ grade ].value = sumOfCO2( co2FromVolume( r ), 1 )
			}

			let prod = []
			// Fill out gap between production and projection (if any)
			const gapStart = Math.min( limits.production.oil.lastYear, limits.production.gas.lastYear )
			const gapEnd = Math.max( limits.projection.oil.firstYear, limits.projection.gas.firstYear, gapStart )
			DEBUG && console.log( { reservesSourceId, useGrades, lastReserves, limits, gapStart, gapEnd } )

			if( gapStart > 0 ) {
				for( let y = gapStart; y < gapEnd; y++ ) {
					if( limits.production.oil.lastYear <= y )
						prod.push( {
							...stableProduction.oil,
							year: y,
							fossilFuelType: 'oil',
							sourceId: projectionSourceId
						} )
					if( limits.production.gas.lastYear <= y )
						prod.push( {
							...stableProduction.gas,
							year: y,
							fossilFuelType: 'gas',
							sourceId: projectionSourceId
						} )
				}
			}

			prod.forEach( ( datapoint, index ) => {
				if( !datapoint.unit ) {
					console.log( { prod, index, datapoint } )
					throw new Error( `Malformed production data, no unit: ` + JSON.stringify( datapoint ) )
				}
				return datapoint.co2 = co2FromVolume( datapoint )
			} )

			projection.forEach( ( datapoint, index ) => {
				if( datapoint.sourceId !== projectionSourceId ) return
				if( datapoint.year < gapEnd ) return
				if( !datapoint.unit ) {
					console.log( { projection, index, datapoint } )
					throw new Error( `Malformed projection data, no unit: ` + JSON.stringify( datapoint ) )
				}

				let _dp = { ...datapoint }
				_dp.co2 = co2FromVolume( datapoint )

				const pointProduction = sumOfCO2( _dp.co2, 1 )
				_dp.plannedProd = 0
				_dp.continProd = 0

				const fuelReserve = lastReserves[ datapoint.fossilFuelType ]

				// Subtract production from planned reserves first, then from contingent.

				if( fuelReserve.p.value > pointProduction ) {
					_dp.plannedProd = pointProduction
					fuelReserve.p.value -= _dp.plannedProd
				} else if( fuelReserve.p.value > 0 ) {
					_dp.continProd = pointProduction - fuelReserve.p.value
					_dp.plannedProd = fuelReserve.p.value
					fuelReserve.p.value = 0
					if( _dp.continProd > fuelReserve.c.value ) _dp.continProd = fuelReserve.c.value
					fuelReserve.c.value -= _dp.continProd
				} else if( fuelReserve.c.value > 0 ) {
					_dp.plannedProd = 0
					_dp.continProd = Math.min( fuelReserve.c.value, pointProduction )
					fuelReserve.c.value -= _dp.continProd
				}
				prod.push( _dp )
			} )

			DEBUG && console.log( { gapStart, gapEnd, prod, lastReserves } )

			return prod
		}

	const getCountryCurrentCO2 = async iso3166 => {
		if( !iso3166 ) return 0

		try {
			const q = await apolloClient.query( {
				query: GQL_countryCurrentProduction,
				variables: { iso3166 }
			} )
			const prod = q.data?.getCountryCurrentProduction?.nodes ?? []
			const principal = prod.filter( p => p.sourceId === settings.principalProductionSourceId[ p.fossilFuelType ] )
			DEBUG && console.log( { principal } )
			let co2 = {}, total = 0
			principal.forEach( p => {
				DEBUG && console.log( co2 )
				const calc = co2FromVolume( p )
				DEBUG && console.log( { calc, p } )
				if( !co2[ p.fossilFuelType ] ) co2[ p.fossilFuelType ] = 0
				co2[ p.fossilFuelType ] += calc.scope1[ 1 ] + calc.scope3[ 1 ]
				total += calc.scope1[ 1 ] + calc.scope3[ 1 ]
			} )
			co2.total = total
			DEBUG && console.log( 'Country Production', co2 )
			return co2
		} catch( e ) {
			notification.error( {
				message: 'Failed to fetch country production',
				description: e.message,
				duration: 20
			} )
		}
	}

	const projectCO2 = ( project ) => {
		const points = project?.projectDataPoints?.nodes ?? []
		if( !points.length ) return 0

		const lastYearProd = points.filter( p => p.dataType === 'PRODUCTION' ).reduce( ( last, point ) => {
			if( point.year > last.year )
				return point
			else
				return last
		}, { year: 0 } )

		const co2 = co2FromVolume( { ...lastYearProd, methaneM3Ton: project.methaneM3Ton } )
		co2.megatons = convertVolume( lastYearProd, 'e9ton' )
		co2.scope1 = co2.scope1?.map( c => Math.round( c * 100 ) / 100 )
		co2.scope3 = co2.scope3?.map( c => Math.round( c * 100 ) / 100 )

		const sources = points.reduce( ( s, p ) => {
			if( !s.includes( p.sourceId ) ) s.push( p.sourceId )
			return s
		}, [] )

		co2.sources = sources.map( id => allSources.find( s => s.sourceId === id ) )

		return co2
	}

	return {
		co2FromVolume,
		convertVolume,
		reservesProduction,
		getCountryCurrentCO2,
		projectCO2,
		pageQuery,
		goToCountryOverview,
		conversionPathLoggerReset
	}
}
